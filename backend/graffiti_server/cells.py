"""Location cell helpers.

The client uses the same geohash encoder and sends only this cell id to the
backend. Exact coordinates stay on-device.
"""

from __future__ import annotations

BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
BASE32_SET = set(BASE32)


def encode_geohash(latitude: float, longitude: float, precision: int = 7) -> str:
    """Encode coordinates into a geohash cell.

    Precision 7 is roughly street-block sized. It is not exactly 100m globally,
    but it is a good MVP tradeoff and can be swapped behind this helper later.
    """
    if not (-90 <= latitude <= 90):
        raise ValueError("latitude must be between -90 and 90")
    if not (-180 <= longitude <= 180):
        raise ValueError("longitude must be between -180 and 180")
    if not (1 <= precision <= 12):
        raise ValueError("precision must be between 1 and 12")

    lat_range = [-90.0, 90.0]
    lon_range = [-180.0, 180.0]
    bits = [16, 8, 4, 2, 1]
    bit_index = 0
    char_value = 0
    even_bit = True
    chars: list[str] = []

    while len(chars) < precision:
        if even_bit:
            midpoint = (lon_range[0] + lon_range[1]) / 2
            if longitude >= midpoint:
                char_value |= bits[bit_index]
                lon_range[0] = midpoint
            else:
                lon_range[1] = midpoint
        else:
            midpoint = (lat_range[0] + lat_range[1]) / 2
            if latitude >= midpoint:
                char_value |= bits[bit_index]
                lat_range[0] = midpoint
            else:
                lat_range[1] = midpoint

        even_bit = not even_bit
        if bit_index < 4:
            bit_index += 1
        else:
            chars.append(BASE32[char_value])
            bit_index = 0
            char_value = 0

    return "".join(chars)


def normalize_geohash(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("geohash is required")
    geohash = value.strip().lower()
    if not (5 <= len(geohash) <= 9):
        raise ValueError("geohash length must be between 5 and 9")
    if any(char not in BASE32_SET for char in geohash):
        raise ValueError("geohash contains invalid characters")
    return geohash
