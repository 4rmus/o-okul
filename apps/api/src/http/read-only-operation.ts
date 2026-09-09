import { SetMetadata } from "@nestjs/common";
export const readOnlyOperationMetadata = "o-okul:read-only-operation";
/** Only for handlers whose storage operations are read-only, including failure paths. */
export const ReadOnlyOperation = () => SetMetadata(readOnlyOperationMetadata, true);
