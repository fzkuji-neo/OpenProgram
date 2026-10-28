/** FileTree row presentation primitives. */
import { FileTypeIcon } from "../file-type-icon";
import styles from "../files-panel.module.css";

export function FileGlyph({ name }: { name: string }) {
  return <FileTypeIcon name={name} className={styles.treeIcon} />;
}
