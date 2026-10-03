// UI entry point: components and Server Actions. Domain API: ./index.ts
export { deleteTemplateAction, renameTemplateAction, trashOutlineAction } from "./actions";
export { BeatBoard } from "./components/beat-board";
export { NewStructureDialog } from "./components/new-structure-dialog";
export { OutlineList } from "./components/outline-list";
export { OutlineTitle } from "./components/outline-title";
export { ArcRoleSelect, SaveTemplateDialog } from "./components/outline-tools";
export { RomanceProgression } from "./components/romance-progression";
export { SceneBeats } from "./components/scene-beats";
export { TemplateList } from "./components/template-list";
export { ARC_ROLE_LABELS, STRUCTURE_KIND_LABELS } from "./labels";
