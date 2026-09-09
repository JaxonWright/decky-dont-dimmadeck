import { definePlugin } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { FaMugHot } from "react-icons/fa";

import { Panel } from "./components/Panel";
import { KeepAwakeController } from "./controller";

export default definePlugin(() => {
  const controller = new KeepAwakeController();
  void controller.init();

  return {
    name: "Don't Dimmadeck",
    titleView: <div className={staticClasses.Title}>Don't Dimmadeck</div>,
    content: <Panel controller={controller} />,
    icon: <FaMugHot />,
    onDismount() {
      controller.dispose();
    },
  };
});
