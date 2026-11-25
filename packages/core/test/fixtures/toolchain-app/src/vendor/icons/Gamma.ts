import { register } from './registry';

// A module with a side effect, the way an icon package registering itself has one: tree-shaking may not
// drop it, so whether this string reaches the browser depends only on whether the module was imported.
register('icon-marker-gamma');

export default function Gamma(): string {
  return 'gamma';
}
