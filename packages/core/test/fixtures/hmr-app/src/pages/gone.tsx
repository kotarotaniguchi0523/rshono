import { notFound } from '@rsvhono/core/server';

export default function Gone(): never {
  notFound();
}
