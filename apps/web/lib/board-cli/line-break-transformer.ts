export class LineBreakTransformer implements Transformer<string, string> {
  private buffer = '';

  transform(chunk: string, controller: TransformStreamDefaultController<string>) {
    this.buffer += chunk;
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? '';

    for (const line of parts) {
      controller.enqueue(line);
    }
  }

  flush(controller: TransformStreamDefaultController<string>) {
    if (this.buffer.length > 0) {
      controller.enqueue(this.buffer);
      this.buffer = '';
    }
  }
}
