import type { EditorDocument } from "../types";
import { cloneDoc } from "./document";

export class HistoryStack {
  private undoStack: EditorDocument[] = [];
  private redoStack: EditorDocument[] = [];
  private labels: string[] = [];

  reset(doc: EditorDocument) {
    this.undoStack = [cloneDoc(doc)];
    this.redoStack = [];
    this.labels = ["New"];
  }

  push(doc: EditorDocument, label = "Edit") {
    this.undoStack.push(cloneDoc(doc));
    this.redoStack = [];
    this.labels.push(label);
    if (this.undoStack.length > 60) {
      this.undoStack.shift();
      this.labels.shift();
    }
  }

  undo(current: EditorDocument): EditorDocument | null {
    if (this.undoStack.length < 2) return null;
    this.redoStack.push(cloneDoc(current));
    this.undoStack.pop();
    this.labels.pop();
    return cloneDoc(this.undoStack[this.undoStack.length - 1]);
  }

  redo(current: EditorDocument): EditorDocument | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneDoc(next));
    this.labels.push("Redo");
    return cloneDoc(next);
  }

  get canUndo() {
    return this.undoStack.length > 1;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get label() {
    return this.labels[this.labels.length - 1] ?? "";
  }
}
