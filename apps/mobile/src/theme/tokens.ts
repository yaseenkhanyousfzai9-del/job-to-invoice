export const colors = {
  primary: "#17324D",
  background: "#F7F8FA",
  text: "#17212B",
  secondary: "#52606D",
  border: "#D5DCE3",
} as const;

export const spacing = {
  x1: 8,
  x2: 16,
  x3: 24,
  x4: 32,
  x5: 40,
  x6: 48,
} as const;

export const layout = {
  screenGutter: 16,
  cornerRadius: 12,
  buttonMinHeight: 48,
  minTouchTarget: 44,
} as const;

export const typography = {
  body: { fontSize: 17, fontWeight: "400" as const },
  secondary: { fontSize: 15, fontWeight: "400" as const },
  sectionTitle: { fontSize: 22, fontWeight: "600" as const },
  screenTitle: { fontSize: 28, fontWeight: "700" as const },
} as const;
