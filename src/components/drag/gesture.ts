/** Generation token so a cancelled long-press cannot arm after measureInWindow. */
export function createDragGesture() {
  let epoch = 0;
  return {
    begin(): number {
      epoch += 1;
      return epoch;
    },
    current(): number {
      return epoch;
    },
    live(token: number): boolean {
      return token > 0 && token === epoch;
    },
    cancel(): void {
      epoch += 1;
    },
  };
}

