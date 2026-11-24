import { redirect } from '@rshono/core/server';

export default function Moved(): never {
  redirect('/items/1');
}
