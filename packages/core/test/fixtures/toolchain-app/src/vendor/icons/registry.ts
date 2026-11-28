const registered: string[] = [];

export function register(name: string): void {
  registered.push(name);
}

export const registeredIcons = (): readonly string[] => registered;
