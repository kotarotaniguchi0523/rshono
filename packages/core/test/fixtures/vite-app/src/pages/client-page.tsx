'use client';

// A page must be a server component. This one is here to be refused.
export default function ClientPage() {
  return <p>never rendered</p>;
}
