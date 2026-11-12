/** Log mínimo que os casos de uso precisam. Na Function quem implementa é o InvocationContext. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
