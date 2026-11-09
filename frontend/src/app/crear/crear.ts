import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ZeroAddress, formatUnits, isAddress, parseUnits } from 'ethers';
import { debounceTime } from 'rxjs';
import { TransactionService } from '../core/transaction.service';
import { TokenInfo } from '../core/vesting.models';
import { VestingService } from '../core/vesting.service';
import { WalletService } from '../core/wallet.service';

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/** Dirección con formato válido. */
function addressValidator(c: AbstractControl): ValidationErrors | null {
  const v = (c.value as string).trim();
  if (!v) return null; // de eso se encarga required
  if (!isAddress(v)) return { address: true };
  if (v.toLowerCase() === ZeroAddress) return { zeroAddress: true };
  return null;
}

/** "2026-11-09T18:30" (hora local del input) → segundos Unix. */
function toUnix(local: string): number {
  return Math.floor(new Date(local).getTime() / 1000);
}

/** segundos Unix → "2026-11-09T18:30" para un input datetime-local. */
function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * /crear: formulario para crear un acuerdo de vesting.
 * Al enviar hace approve (si hace falta) y después createAgreement.
 */
@Component({
  selector: 'app-crear',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './crear.html',
  styleUrl: './crear.css',
})
export class Crear {
  protected readonly wallet = inject(WalletService);
  protected readonly tx = inject(TransactionService);
  private readonly vesting = inject(VestingService);
  private readonly fb = inject(FormBuilder);

  protected readonly tokenInfo = signal<TokenInfo | null>(null);
  protected readonly balance = signal<bigint | null>(null);
  protected readonly tokenError = signal<string | null>(null);
  /** Hora de la cadena (no la de la PC: en Anvil se puede adelantar el tiempo). */
  protected readonly chainNow = signal<number | null>(null);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly createdId = signal<bigint | null>(null);

  /** Fechas: fin posterior al inicio y en el futuro. El inicio puede estar en el pasado (decisión de diseño). */
  private readonly datesValidator = (g: AbstractControl): ValidationErrors | null => {
    const { start, end } = g.value;
    if (!start || !end) return null;
    if (toUnix(end) <= toUnix(start)) return { endBeforeStart: true };
    const now = this.chainNow();
    if (now !== null && toUnix(end) <= now) return { endInPast: true };
    return null;
  };

  /** Monto: mayor que 0, sin más decimales que el token y sin superar el saldo. */
  private readonly amountValidator = (g: AbstractControl): ValidationErrors | null => {
    const raw = (g.value.amount as string).trim();
    const info = this.tokenInfo();
    if (!raw || !AMOUNT_PATTERN.test(raw) || !info) return null;
    const decimals = raw.split('.')[1]?.length ?? 0;
    if (decimals > info.decimals) return { tooManyDecimals: info.decimals };
    const amount = parseUnits(raw, info.decimals);
    if (amount === 0n) return { zeroAmount: true };
    const balance = this.balance();
    if (balance !== null && amount > balance) return { exceedsBalance: true };
    return null;
  };

  protected readonly form = this.fb.nonNullable.group(
    {
      token: ['', [Validators.required, addressValidator]],
      beneficiary: ['', [Validators.required, addressValidator]],
      amount: ['', [Validators.required, Validators.pattern(AMOUNT_PATTERN)]],
      start: ['', Validators.required],
      end: ['', Validators.required],
      revocable: [true],
    },
    { validators: [this.datesValidator, this.amountValidator] },
  );

  constructor() {
    this.form.controls.token.valueChanges
      .pipe(debounceTime(300), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => void this.loadToken());

    // Recargar saldo y hora al cambiar de cuenta/red o cuando se confirma una transacción.
    effect(() => {
      this.wallet.account();
      this.wallet.chainId();
      this.tx.refreshTick();
      if (!this.wallet.isConnected() || !this.wallet.isAnvil()) return;
      void this.loadChainTime();
      void this.loadToken();
    });
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    this.submitError.set(null);
    this.createdId.set(null);
    await this.loadChainTime(); // revalidar "fin en el futuro" con la hora actual de la cadena
    const info = this.tokenInfo();
    if (this.form.invalid || !info) return;

    const v = this.form.getRawValue();
    const token = v.token.trim();
    const amount = parseUnits(v.amount.trim(), info.decimals); // nunca asumir 18 decimales
    const label = `${v.amount.trim()} ${info.symbol}`;

    this.submitting.set(true);
    try {
      // 1) approve, solo si la allowance actual no alcanza
      if (await this.vesting.needsApproval(token, this.wallet.account()!, amount)) {
        const ok = await this.tx.run(`Aprobar ${label}`, () => this.vesting.approve(token, amount));
        if (!ok) return;
      }
      // 2) crear el acuerdo
      const receipt = await this.tx.run(`Crear acuerdo de ${label}`, () =>
        this.vesting.createAgreement({
          token,
          beneficiary: v.beneficiary.trim(),
          amount,
          startTime: toUnix(v.start),
          endTime: toUnix(v.end),
          revocable: v.revocable,
        }),
      );
      if (!receipt) return;
      this.createdId.set(await this.vesting.agreementIdFromReceipt(receipt));
      this.form.controls.amount.reset('');
    } catch (e) {
      // errores antes de enviar (p. ej. falta deployments.json)
      this.submitError.set(this.vesting.errorMessage(e));
    } finally {
      this.submitting.set(false);
    }
  }

  protected setStartNow(): void {
    const now = this.chainNow();
    if (now !== null) this.form.controls.start.setValue(toLocalInput(now));
  }

  protected formatBalance(): string {
    const info = this.tokenInfo();
    const balance = this.balance();
    return info && balance !== null ? `${formatUnits(balance, info.decimals)} ${info.symbol}` : '';
  }

  /** Muestra el error de un campo solo después de tocarlo. */
  protected fieldError(name: keyof typeof this.form.controls, error: string): boolean {
    const c = this.form.controls[name];
    return c.hasError(error) && (c.touched || c.dirty);
  }

  protected groupError(error: string): boolean {
    return this.form.hasError(error) && (this.form.touched || this.form.dirty);
  }

  private async loadToken(): Promise<void> {
    const address = this.form.controls.token.value.trim();
    this.tokenInfo.set(null);
    this.balance.set(null);
    this.tokenError.set(null);
    const account = this.wallet.account();
    if (!isAddress(address) || !account) return this.revalidate();
    try {
      const [info, balance] = await Promise.all([
        this.vesting.tokenInfo(address),
        this.vesting.tokenBalance(address, account),
      ]);
      if (this.form.controls.token.value.trim() !== address) return; // el usuario ya cambió el campo
      this.tokenInfo.set(info);
      this.balance.set(balance);
    } catch {
      this.tokenError.set('No se pudo leer el token: ¿es un ERC-20 desplegado en esta red?');
    }
    this.revalidate();
  }

  private async loadChainTime(): Promise<void> {
    try {
      const now = await this.vesting.chainTime();
      this.chainNow.set(now);
      if (!this.form.controls.start.value) this.form.controls.start.setValue(toLocalInput(now));
    } catch {
      /* sin conexión a la red: se valida igual al enviar */
    }
    this.revalidate();
  }

  /** Los validadores de grupo leen signals: hay que volver a correrlos cuando cambian. */
  private revalidate(): void {
    this.form.updateValueAndValidity();
  }
}
