const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(latitude: number, longitude: number, precision = 7): string {
  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  const bits = [16, 8, 4, 2, 1];
  let bitIndex = 0;
  let charValue = 0;
  let evenBit = true;
  let hash = '';

  while (hash.length < precision) {
    if (evenBit) {
      const midpoint = (lonRange[0] + lonRange[1]) / 2;
      if (longitude >= midpoint) {
        charValue |= bits[bitIndex];
        lonRange[0] = midpoint;
      } else {
        lonRange[1] = midpoint;
      }
    } else {
      const midpoint = (latRange[0] + latRange[1]) / 2;
      if (latitude >= midpoint) {
        charValue |= bits[bitIndex];
        latRange[0] = midpoint;
      } else {
        latRange[1] = midpoint;
      }
    }

    evenBit = !evenBit;
    if (bitIndex < 4) {
      bitIndex += 1;
    } else {
      hash += BASE32[charValue];
      bitIndex = 0;
      charValue = 0;
    }
  }

  return hash;
}

