import { Home } from '../home/Home';

/** Home for a signed-in reader: the world's home page with the composer and the Everything / Following switch. */
export function HomePage() {
  return <Home authed />;
}
