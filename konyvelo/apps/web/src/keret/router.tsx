// A react-router hivatkozó elemei a futási mód útvonal-előtagjával (KB2). A Könyvelő ezeket használja a
// react-router saját Link/NavLink/Navigate/useNavigate helyett; egy teszt őrzi, hogy ne maradjon közvetlen.
import { forwardRef, useCallback, type ComponentProps } from "react";
import * as RR from "react-router";
import { ut } from "./futas";

type To = RR.To;

function elotagolt(to: To): To {
  if (typeof to === "string") return ut(to);
  return to.pathname ? { ...to, pathname: ut(to.pathname) } : to;
}

export const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof RR.Link>>(function Link({ to, ...p }, ref) {
  return <RR.Link ref={ref} {...p} to={elotagolt(to)} />;
});

export const NavLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof RR.NavLink>>(function NavLink({ to, ...p }, ref) {
  return <RR.NavLink ref={ref} {...p} to={elotagolt(to)} />;
});

export function Navigate({ to, ...p }: ComponentProps<typeof RR.Navigate>) {
  return <RR.Navigate {...p} to={elotagolt(to)} />;
}

export function useNavigate(): RR.NavigateFunction {
  const n = RR.useNavigate();
  return useCallback(((to: To | number, opts?: RR.NavigateOptions) => (typeof to === "number" ? n(to) : n(elotagolt(to), opts))) as RR.NavigateFunction, [n]);
}
