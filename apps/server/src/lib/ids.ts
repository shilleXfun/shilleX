import { monotonicFactory } from 'ulidx';
const ulid = monotonicFactory();
export const newId = (): string => ulid();
