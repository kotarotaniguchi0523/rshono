import { redirect } from '@rsvhono/core/server';

export default function Moved(): never {
  redirect('/items/1');
}
