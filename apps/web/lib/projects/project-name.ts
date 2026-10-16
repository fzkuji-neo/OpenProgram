/** The name a project shows. The home project (the default one) is named
 *  after the home folder; a record from before that, still called
 *  "System" or "Default", shows the folder's name too. */
export function projectName(
  project: { name: string; path?: string | null; is_default?: boolean; custom_name?: boolean },
): string {
  if (project.is_default && !project.custom_name && (!project.name || ["System", "Default"].includes(project.name))) {
    return project.path?.split(/[\\/]/).filter(Boolean).pop() || project.name;
  }
  return project.name;
}
