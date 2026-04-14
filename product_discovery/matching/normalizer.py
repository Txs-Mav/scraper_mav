"""
Product data normalizer — cleans and standardizes raw product data
before matching against canonical products.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional


BRAND_ALIASES: dict[str, str] = {
    "brp": "BRP",
    "can-am": "Can-Am",
    "canam": "Can-Am",
    "can am": "Can-Am",
    "ski-doo": "Ski-Doo",
    "skidoo": "Ski-Doo",
    "ski doo": "Ski-Doo",
    "sea-doo": "Sea-Doo",
    "seadoo": "Sea-Doo",
    "sea doo": "Sea-Doo",
    "lynx": "Lynx",
    "yamaha": "Yamaha",
    "honda": "Honda",
    "kawasaki": "Kawasaki",
    "suzuki": "Suzuki",
    "ktm": "KTM",
    "husqvarna": "Husqvarna",
    "polaris": "Polaris",
    "indian": "Indian",
    "harley-davidson": "Harley-Davidson",
    "harley davidson": "Harley-Davidson",
    "harley": "Harley-Davidson",
    "ducati": "Ducati",
    "bmw": "BMW",
    "triumph": "Triumph",
    "aprilia": "Aprilia",
    "mv agusta": "MV Agusta",
    "royal enfield": "Royal Enfield",
    "cfmoto": "CFMoto",
    "cf moto": "CFMoto",
    "segway": "Segway",
    "arctic cat": "Arctic Cat",
    "textron": "Textron",
}

CATEGORY_ALIASES: dict[str, str] = {
    "motorcycle": "moto",
    "motocyclette": "moto",
    "moto": "moto",
    "snowmobile": "motoneige",
    "motoneige": "motoneige",
    "snow mobile": "motoneige",
    "atv": "vtt",
    "vtt": "vtt",
    "quad": "vtt",
    "side-by-side": "cote-a-cote",
    "sxs": "cote-a-cote",
    "utv": "cote-a-cote",
    "côte à côte": "cote-a-cote",
    "cote a cote": "cote-a-cote",
    "side by side": "cote-a-cote",
    "scooter": "scooter",
    "pwc": "motomarine",
    "personal watercraft": "motomarine",
    "motomarine": "motomarine",
    "jet ski": "motomarine",
    "3-wheel": "3-roues",
    "three-wheel": "3-roues",
    "3 roues": "3-roues",
    "trike": "3-roues",
    "spyder": "3-roues",
    "ryker": "3-roues",
}

NOISE_WORDS = {
    "le", "la", "les", "de", "du", "des", "un", "une",
    "the", "a", "an", "of", "for", "and", "with",
    "en", "au", "aux", "sur", "dans",
    "neuf", "new", "used", "occasion", "usagé", "usagee",
    "disponible", "available", "in stock", "en inventaire",
}

YEAR_PATTERN = re.compile(r"\b(19|20)\d{2}\b")
PRICE_PATTERN = re.compile(r"\$[\d,]+\.?\d*")
WHITESPACE_PATTERN = re.compile(r"\s+")


class ProductNormalizer:
    """Normalizes raw product data into a consistent format for matching."""

    def normalize_brand(self, raw: Optional[str]) -> Optional[str]:
        if not raw:
            return None
        key = raw.strip().lower()
        return BRAND_ALIASES.get(key, raw.strip().title())

    def normalize_category(self, raw: Optional[str]) -> Optional[str]:
        if not raw:
            return None
        key = raw.strip().lower()
        return CATEGORY_ALIASES.get(key, key)

    def normalize_title(self, title: str) -> str:
        """Produce a clean, lowercase title suitable for fuzzy comparison."""
        text = title.lower()
        text = unicodedata.normalize("NFKD", text)
        text = PRICE_PATTERN.sub("", text)
        text = re.sub(r"[^\w\s\-.]", " ", text)
        tokens = text.split()
        tokens = [t for t in tokens if t not in NOISE_WORDS]
        return WHITESPACE_PATTERN.sub(" ", " ".join(tokens)).strip()

    def extract_year(self, text: str) -> Optional[int]:
        match = YEAR_PATTERN.search(text)
        if match:
            year = int(match.group())
            if 1970 <= year <= 2030:
                return year
        return None

    def extract_brand_from_title(self, title: str) -> Optional[str]:
        title_lower = title.lower()
        for alias, canonical in sorted(BRAND_ALIASES.items(), key=lambda x: -len(x[0])):
            if alias in title_lower:
                return canonical
        return None

    def normalize_identifier(self, value: Optional[str]) -> Optional[str]:
        """Strip and uppercase identifiers for consistent comparison."""
        if not value:
            return None
        cleaned = re.sub(r"[\s\-]", "", value.strip().upper())
        return cleaned if cleaned else None

    def normalize_price(self, raw: str | float | int | None) -> Optional[float]:
        if raw is None:
            return None
        if isinstance(raw, (int, float)):
            return float(raw)
        cleaned = re.sub(r"[^\d.]", "", str(raw))
        try:
            return float(cleaned)
        except ValueError:
            return None
