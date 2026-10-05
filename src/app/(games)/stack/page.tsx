import StackModes from './_stack-modes';
import { stackModeFromParams } from './_stack-mode';

export { metadata } from './metadata';

export default async function StackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <StackModes initialMode={stackModeFromParams(await searchParams)} />;
}
