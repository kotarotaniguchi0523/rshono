'use server';

import { getRequestContext, notFound, redirect, requestRefresh } from '@rsvhono/core/server';
import { fakeDB, type User } from './db';
import { likes, raceLog } from './race-log';

// Not exported — a 'use server' module may only export async functions.
/**
 * A form field as trimmed text. `FormData.get` also yields `File` for a file input, which stringifies to
 * `[object File]`; anything that is not already a string is treated as absent.
 */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function createUser(data: { name: string; email: string }): Promise<User> {
  if (!data.name.trim() || !data.email.includes('@')) {
    throw new Error('A name and a valid email are required.');
  }
  return fakeDB.createUser({ name: data.name.trim(), email: data.email.trim() });
}

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = field(formData, 'email');
  if (!email.includes('@')) return { error: 'Enter a valid email address.' };
  getRequestContext().cookies.set('session', encodeURIComponent(email), { path: '/', httpOnly: true, sameSite: 'Lax' });
  redirect('/dashboard');
}

/**
 * The other half of `login`, and the one that exercises a redirect on the *client-initiated* action
 * path: a `'use client'` button calls this directly, so the reply comes back as a flight payload
 * carrying `redirect` rather than as an HTTP 3xx. Takes no arguments, which is what makes it callable
 * from a test with a plain `[]` body.
 */
export async function logout(): Promise<never> {
  const ctx = getRequestContext();
  ctx.cookies.delete('session', { path: '/' });
  redirect('/login');
}

export interface CrashState {
  ok?: boolean;
}

/**
 * Always throws — a deliberate demo that a progressive-enhancement form action
 * failure is routed to the `error` page even without JavaScript, rather than
 * swallowed into a blank 500. Exercised by the e2e suite.
 */
export async function crash(_prev: CrashState, _formData: FormData): Promise<CrashState> {
  throw new Error('Intentional server-action failure (progressive-enhancement demo).');
}

export interface SignupState {
  message?: string;
  error?: string;
}

export async function signup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const name = field(formData, 'name');
  const email = field(formData, 'email');
  if (!name || !email.includes('@')) {
    return { error: 'Please provide a name and a valid email address.' };
  }
  const user = await fakeDB.createUser({ name, email });
  getRequestContext().cookies.set('welcomed', encodeURIComponent(user.name), { path: '/', httpOnly: true });
  return { message: `Welcome aboard, ${user.name}! (user #${user.id})` };
}

/**
 * The *other* shape a form action takes, and the one nothing else here covers: a server component renders
 * `<form action={subscribe}>`, so React posts a single `$ACTION_ID_<id>` field and there is no
 * `useActionState` and no form state to decode. The three forms above are all the `useActionState` shape.
 *
 * One argument, the form's own data, because that is what React binds for this shape.
 */
export async function subscribe(formData: FormData): Promise<void> {
  const email = field(formData, 'email');
  if (!email.includes('@')) return;
  getRequestContext().cookies.set('subscribed', email, { path: '/', httpOnly: true });
}

/**
 * Applies `label` after `delayMs` — so a test decides the order two overlapping calls land in on the server,
 * independently of the order the browser made them in. See `/action-race`.
 */
export async function recordRace(label: string, delayMs: number): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(Number(delayMs) || 0, 0), 5000)));
  raceLog.push(String(label).slice(0, 80));
  return label;
}

/**
 * Counts up after `ms` — a `useActionState` action with a server-side delay a test controls. See
 * `/transition-probe`.
 */
export async function probeEcho(previous: number, formData: FormData): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, Math.min(Number(formData.get('ms')) || 0, 5000)));
  return previous + 1;
}

/**
 * An action that ends in a route intent instead of a value: `notFound()`, or a `redirect()` to wherever the
 * form says — another origin included. Posted by the form on `/action-race`, with or without JavaScript.
 */
export async function raiseSignal(formData: FormData): Promise<void> {
  const to = formData.get('to');
  if (typeof to === 'string' && to !== '') redirect(to);
  notFound();
}

/**
 * `recordRace`, and then asks for the page — twice, which has to be one render. Under the default refresh
 * mode the page is rendered anyway; under `'explicit'` this is the only thing that renders it.
 */
export async function recordRaceAndRefresh(label: string): Promise<string> {
  raceLog.push(String(label).slice(0, 80));
  requestRefresh();
  requestRefresh();
  return label;
}

/** Counts a like after a moment, and returns the new total — what an optimistic update settles to. */
export async function like(): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return ++likes.count;
}

/** Returns a value part of which is not ready yet: the reply streams it, page or no page. */
export async function streamed(label: string): Promise<{ now: string; later: Promise<string> }> {
  return { now: label, later: new Promise((resolve) => setTimeout(() => resolve(`${label}-later`), 200)) };
}

/** How far each `ticking` run has got, by label — read back by `tickCount`, so a test can see a run stop. */
const ticks = new Map<string, number>();

/**
 * Returns an async iterable: `count` values, one every `intervalMs`. The reply streams them as they are
 * made. If the client goes away the generator has nobody to yield to, and should not go on making values.
 */
export async function ticking(label: string, count: number, intervalMs: number): Promise<AsyncIterable<number>> {
  ticks.set(label, 0);
  return (async function* () {
    for (let n = 1; n <= count; n++) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      ticks.set(label, n);
      yield n;
    }
  })();
}

export async function tickCount(label: string): Promise<number> {
  return ticks.get(label) ?? -1;
}

/** A value three promises deep, each ready later than the one around it. */
export async function nested(label: string): Promise<{ a: Promise<{ b: Promise<{ c: string }> }> }> {
  const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  return { a: later(50, { b: later(100, { c: `${label}-deep` }) }) };
}

/** Returns a value whose second half fails while the reply is already on the wire. */
export async function failsLate(label: string): Promise<{ now: string; later: Promise<string> }> {
  return { now: label, later: new Promise((_, reject) => setTimeout(() => reject(new Error(`late failure ${label}`)), 100)) };
}

/**
 * Hands back what it was given. Called with something flight cannot serialize — a function, a class
 * instance — the argument crosses as a temporary reference, and the reply has to name the same one for the
 * caller to get its own object back.
 */
export async function handBack<T>(value: T): Promise<{ same: T }> {
  return { same: value };
}
