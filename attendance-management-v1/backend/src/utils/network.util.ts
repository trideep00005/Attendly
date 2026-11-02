import os from 'node:os';

export function getLanAddresses(): string[] {
  return Object.values(os.networkInterfaces()).flatMap((items) =>
    (items ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal)
      .map((item) => item.address),
  );
}
