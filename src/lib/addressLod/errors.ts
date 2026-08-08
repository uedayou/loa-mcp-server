export class AddressLodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressLodError";
  }
}

export class AddressNotFoundError extends AddressLodError {
  constructor(entityPath: string) {
    super(`Address not found: ${entityPath}`);
    this.name = "AddressNotFoundError";
  }
}
