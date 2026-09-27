import type { ReactNode } from "react";
// Header and footer for the long-form pages. To move to new site chrome, change this one import
// (and the element below); the pages themselves import only this file and docs.module.css.
import Site from "../_site/Site";
import d from "./docs.module.css";

export type DocNav = "methods" | "limitations";

export default function Shell({ children, current }: { children: ReactNode; current?: DocNav }) {
  return (
    <Site current={current}>
      <div className={d.doc}>{children}</div>
    </Site>
  );
}
