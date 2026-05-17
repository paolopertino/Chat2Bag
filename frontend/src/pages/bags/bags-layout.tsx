import { Outlet } from "react-router-dom";

import { useBags } from "../../context/bags-context";

export type BagsOutletContext = ReturnType<typeof useBags>;

export function BagsLayout() {
  const bagsState = useBags();
  return <Outlet context={bagsState} />;
}
