"""
Fetch the full Quran (Arabic, English translation, transliteration) and
surah metadata (Meccan/Medinan). Merges into 6,236 verse rows.

Uses AlQuran.cloud public API. Free, no key needed.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import requests
from tqdm import tqdm

HERE = Path(__file__).parent
OUT = HERE / "data"
OUT.mkdir(exist_ok=True)


def fetch(url: str) -> dict[str, Any]:
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


def main() -> None:
    print("Fetching Arabic (Uthmani)...")
    arabic = fetch("https://api.alquran.cloud/v1/quran/quran-uthmani")["data"]["surahs"]
    print("Fetching English (Sahih International)...")
    english = fetch("https://api.alquran.cloud/v1/quran/en.sahih")["data"]["surahs"]
    print("Fetching Transliteration...")
    translit = fetch("https://api.alquran.cloud/v1/quran/en.transliteration")["data"]["surahs"]

    # Build {surah_number: {"revelationType": ..., "englishName": ...}}
    surah_meta = {}
    for s in arabic:
        surah_meta[s["number"]] = {
            "englishName": s["englishName"],
            "arabicName": s["name"],
            "revelationType": s["revelationType"],
            "ayahCount": len(s["ayahs"]),
        }

    verses = []
    vid = 0
    print("Merging verses...")
    for sA, sE, sT in tqdm(zip(arabic, english, translit), total=len(arabic)):
        snum = sA["number"]
        meta = surah_meta[snum]
        for aA, aE, aT in zip(sA["ayahs"], sE["ayahs"], sT["ayahs"]):
            vid += 1
            verses.append({
                "id": vid,
                "surah": snum,
                "ayah": aA["numberInSurah"],
                "surahName": meta["englishName"],
                "surahArabic": meta["arabicName"],
                "revelationType": meta["revelationType"],  # "Meccan" or "Medinan"
                "arabic": aA["text"],
                "translation": aE["text"],
                "transliteration": aT["text"],
            })

    out_file = OUT / "raw_verses.json"
    out_file.write_text(json.dumps(verses, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(verses)} verses to {out_file}")
    assert len(verses) == 6236, f"Expected 6236 verses, got {len(verses)}"


if __name__ == "__main__":
    main()
