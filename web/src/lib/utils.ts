import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn 约定：条件类名合并，后者覆盖前者的同族 Tailwind 工具类 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
