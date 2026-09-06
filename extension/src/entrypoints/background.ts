/**
 * MV3 service worker. Sprint 1: proves the build. T-028 adds the alarm-driven
 * "when to pop" scheduler; T-031 adds the offline queue.
 */
export default defineBackground(() => {
  console.log('learnos background started', { id: browser.runtime.id });
});
