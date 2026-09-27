// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Pencil } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton";

afterEach(cleanup);

it("shows only its icon, names itself on hover, and can carry a count", async () => {
  const onClick = vi.fn();
  render(<IconButton label="Edit" hint="Change the words" icon={Pencil} badge={3} onClick={onClick} />);
  fireEvent.click(screen.getByLabelText("Edit"));
  expect(onClick).toHaveBeenCalled();
  expect(screen.getByText("3")).toBeTruthy();
  fireEvent.mouseEnter(screen.getByLabelText("Edit"));
  expect((await screen.findByRole("tooltip")).textContent).toBe("EditChange the words");
});
