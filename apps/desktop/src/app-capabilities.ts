export const publicDemo = import.meta.env.MODE === "demo";
export const appCapabilities = Object.freeze({
  publicDemo,
  localReads: !publicDemo,
  importComparison: !publicDemo,
  generateInsights: !publicDemo,
});
