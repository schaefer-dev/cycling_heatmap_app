import type { RideDetail } from '../../api';

/** Readable names of the devices that recorded a ride (head unit, sensors), de-duplicated. */
export function deviceNames(devices: RideDetail['devices']): string[] {
  const names = devices
    .map((d) => {
      const product = d.product_name ?? d.product;
      const maker = d.manufacturer;
      if (product && maker && !String(product).toLowerCase().includes(String(maker).toLowerCase()))
        return `${maker} ${product}`;
      return product ?? maker ?? null;
    })
    .filter((n): n is string | number => n !== null && n !== '')
    .map(String);
  return [...new Set(names)];
}
