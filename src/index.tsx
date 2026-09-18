import { definePlugin } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { GiTopHat } from "react-icons/gi";

import { Panel } from "./components/Panel";
import { KeepAwakeController } from "./controller";

export default definePlugin(() => {
  const controller = new KeepAwakeController();
  void controller.init();

  return {
    name: "Don't Dimmadeck",
    titleView: <div className={staticClasses.Title}>Don't Dimmadeck</div>,
    content: <Panel controller={controller} />,
    icon: <GiTopHat />,
    onDismount() {
      controller.dispose();
    },
  };
});
