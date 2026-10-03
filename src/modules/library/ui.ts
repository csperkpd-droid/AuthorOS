// UI entry point: components and Server Actions. Domain API: ./index.ts
export { trashBookAction, trashSeriesAction } from "./actions";
export { BookCard } from "./components/book-card";
export { BookDialog } from "./components/book-dialog";
export type { EditableBook } from "./components/book-dialog";
export { SeriesBookOrder } from "./components/series-book-order";
export { SeriesDialog } from "./components/series-dialog";
