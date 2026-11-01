"use client";
import { Children, Fragment, isValidElement } from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
function options(children) {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    if (child.type === Fragment) return options(child.props.children);
    return child.type === "option" ? [child.props] : [];
  });
}
export default function Select({
  children,
  value,
  onChange,
  disabled,
  id,
  name,
  required,
  className = "",
  ...props
}) {
  const items = options(children),
    placeholder =
      items.find((item) => item.value === "")?.children || "Select an option";
  const choices = items.filter((item) => String(item.value ?? "") !== "");
  return (
    <Primitive.Root
      value={String(value ?? "")}
      onValueChange={(next) => onChange?.({ target: { value: next } })}
      disabled={disabled || !choices.length}
      name={name}
      required={required}
    >
      <Primitive.Trigger
        {...props}
        id={id}
        className={"select-trigger " + className}
      >
        <Primitive.Value placeholder={placeholder} />
        <Primitive.Icon className="select-chevron">
          <ChevronDown size={14} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          className="select-popup"
          position="popper"
          sideOffset={5}
          collisionPadding={12}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <Primitive.ScrollUpButton className="select-scroll">
            <ChevronUp size={13} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="select-options">
            {choices.map((item) => (
              <Primitive.Item
                key={item.value}
                value={String(item.value)}
                disabled={item.disabled}
                className="select-option"
              >
                <Primitive.ItemText>{item.children}</Primitive.ItemText>
                <Primitive.ItemIndicator className="select-check">
                  <Check size={13} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="select-scroll">
            <ChevronDown size={13} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
