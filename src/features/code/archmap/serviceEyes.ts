// Service eyes: which detected services scope "all" shows and
// analyzes. Small projects map by themselves; above the threshold
// a service stays closed until the person opens it by clicking its
// name or its eye in Folders. Explicit choices always win over the
// default. Pure and tested; both Folders and Architecture read it.
export const SERVICE_EYE_THRESHOLD = 3;

/**
 * Whether a detected service eye is open. `hidden` holds explicit
 * hides (`true`) and explicit opens (`false`); `opened` records
 * services the person opened before; `total` counts every detected
 * service of the project.
 */
export function serviceEyeOpen(
  key: string,
  hidden: Record<string, boolean>,
  opened: Record<string, boolean>,
  total: number,
): boolean {
  if (hidden[key] === true) return false;
  if (hidden[key] === false) return true;
  if (total <= SERVICE_EYE_THRESHOLD) return true;
  return opened[key] === true;
}
