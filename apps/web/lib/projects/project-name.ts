/** The name a project shows: the System project (the default one) reads
 *  "System" in the UI language unless the user renamed it. */
export function projectName(
  project: { name: string; is_default?: boolean; custom_name?: boolean },
  text: (en: string, zh: string) => string,
): string {
  return project.is_default && !project.custom_name ? text("System", "系统") : project.name;
}
