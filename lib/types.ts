export type RevelationType = "Meccan" | "Medinan";

export interface Verse {
  id: number;
  surah: number;
  ayah: number;
  surahName: string;
  surahArabic: string;
  revelationType: RevelationType;
  arabic: string;
  translation: string;
  transliteration: string;
  x: number;
  y: number;
  z: number;
  cluster: number;
  neighbors: number[];
  /** 64-dim L2-normalised PCA embedding */
  e: number[];
}

export interface Surah {
  number: number;
  englishName: string;
  arabicName: string;
  revelationType: RevelationType;
  ayahCount: number;
}
