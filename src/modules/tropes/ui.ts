// UI entry point: components and Server Actions. Domain API: ./index.ts
export {
  addTropeAction,
  createTropeAction,
  removeTropeAction,
  restoreTropeAction,
  trashTropeAction,
  updateTropeAction,
} from "./actions";
export { NewTropeDialog, TropeForm } from "./components/trope-form";
export { TropePicker } from "./components/trope-picker";
