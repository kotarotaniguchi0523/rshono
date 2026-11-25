import { notFound } from '@rshono/core/server';

export default function Gone(): never {
  notFound();
}
