import {
  ArrowRight,
  Bookmark,
  Clock3,
  Crop,
  Download,
  ExternalLink,
  House,
  Import,
  MessageSquarePlus,
  PanelTop,
  PictureInPicture2,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

/** Row icons a desktop overlay menu can draw. The overlay is another
 *  document, so an opener names the icon and the overlay looks it up here;
 *  the Web fallback menus use the same table, so both draw the same glyph. */
export const MENU_GLYPHS = {
  "arrow-right": ArrowRight,
  bookmark: Bookmark,
  clock: Clock3,
  crop: Crop,
  download: Download,
  "external-link": ExternalLink,
  house: House,
  import: Import,
  "message-plus": MessageSquarePlus,
  "panel-top": PanelTop,
  "picture-in-picture": PictureInPicture2,
  plus: Plus,
  printer: Printer,
  "rotate-ccw": RotateCcw,
  search: Search,
  settings: Settings,
  trash: Trash2,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
} satisfies Record<string, LucideIcon>;

export type MenuGlyph = keyof typeof MENU_GLYPHS;

export function isMenuGlyph(value: unknown): value is MenuGlyph {
  return typeof value === "string" && Object.hasOwn(MENU_GLYPHS, value);
}
