"use client";

import { Send } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  buildProductSelectionAnswerValue,
  buildProductSelectionCartAnswerValue,
  getActionStepChoiceDisplayMode,
  getActionStepInputType,
  getActionStepOptions,
  getActionStepProductDisplayLayout,
  getActionStepProductSelectionAllowMultiple,
  getActionStepProductSelectionAllowQuantity,
  getActionStepPrompt,
  type RuntimeActionStep,
} from "@/lib/action-runtime";
import { getFlowFileAcceptAttribute } from "@/lib/flow-file-validation";

type ActionFlowStepInputProps = {
  step: RuntimeActionStep;
  value: string;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  onFileSubmit?: (file: File) => void | Promise<void>;
  onSubmit: (value: string) => void | Promise<void>;
};

type ActionFlowStepOptionsProps = {
  step: RuntimeActionStep;
  fields?: Record<string, unknown>;
  disabled?: boolean;
  onSelect: (value: string) => void | Promise<void>;
};

type AddressFormState = {
  city: string;
  country: string;
  line1: string;
  line2: string;
  postalCode: string;
  region: string;
};

type LocationFormState = {
  error: string;
  label: string;
  latitude: string;
  longitude: string;
};

function getInputConfig(inputType: string | null) {
  switch (inputType) {
    case "date":
    case "email":
    case "tel":
    case "time":
      return { type: inputType };
    case "phone":
      return { type: "tel" };
    case "int":
      return { inputMode: "numeric", step: "1", type: "number" };
    case "float":
      return { inputMode: "decimal", step: "any", type: "number" };
    default:
      return { type: "text" };
  }
}

function formatOptionPrice(metadata: Record<string, unknown> | undefined) {
  const priceAmount = metadata?.priceAmount;

  if (typeof priceAmount !== "number") {
    return "";
  }

  return new Intl.NumberFormat("en", {
    currency:
      typeof metadata?.currency === "string" ? metadata.currency : "USD",
    style: "currency",
  }).format(priceAmount / 100);
}

export function ActionFlowStepInput({
  step,
  value,
  disabled = false,
  compact = false,
  onChange,
  onFileSubmit,
  onSubmit,
}: ActionFlowStepInputProps) {
  const [file, setFile] = useState<File | null>(null);
  const [address, setAddress] = useState<AddressFormState>({
    city: "",
    country: "",
    line1: "",
    line2: "",
    postalCode: "",
    region: "",
  });
  const [location, setLocation] = useState<LocationFormState>({
    error: "",
    label: "",
    latitude: "",
    longitude: "",
  });
  const inputConfig = getInputConfig(getActionStepInputType(step));
  const placeholder = getActionStepPrompt(step);
  const isFileUpload = step.stepType === "file_upload";
  const fileAccept = getFlowFileAcceptAttribute(
    typeof step.settings.validationAllowedFileTypes === "string"
      ? step.settings.validationAllowedFileTypes
      : null,
  );
  const isAddress = step.stepType === "address";
  const isLocation = step.stepType === "location";
  const hasAddressValue = [
    address.line1,
    address.line2,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ].some((part) => part.trim().length > 0);
  const hasLocationValue =
    location.label.trim().length > 0 ||
    (location.latitude.trim().length > 0 &&
      location.longitude.trim().length > 0);
  const canSubmit =
    (isFileUpload
      ? Boolean(file)
      : isAddress
        ? hasAddressValue
        : isLocation
          ? hasLocationValue
          : value.trim().length > 0) && !disabled;

  useEffect(() => {
    const currentStepId = step.id;
    void currentStepId;
    setFile(null);
    setAddress({
      city: "",
      country: "",
      line1: "",
      line2: "",
      postalCode: "",
      region: "",
    });
    setLocation({
      error: "",
      label: "",
      latitude: "",
      longitude: "",
    });
  }, [step.id]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    if (isFileUpload) {
      if (file && onFileSubmit) {
        await onFileSubmit(file);
        setFile(null);
      }
      return;
    }

    if (isAddress) {
      const formatted = [
        address.line1,
        address.line2,
        address.city,
        address.region,
        address.postalCode,
        address.country,
      ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", ");

      await onSubmit(
        JSON.stringify({
          city: address.city.trim() || undefined,
          country: address.country.trim() || undefined,
          formatted,
          line1: address.line1.trim() || undefined,
          line2: address.line2.trim() || undefined,
          postalCode: address.postalCode.trim() || undefined,
          region: address.region.trim() || undefined,
        }),
      );
      return;
    }

    if (isLocation) {
      const latitude = location.latitude.trim()
        ? Number(location.latitude)
        : undefined;
      const longitude = location.longitude.trim()
        ? Number(location.longitude)
        : undefined;

      await onSubmit(
        JSON.stringify({
          label:
            location.label.trim() ||
            (typeof latitude === "number" && typeof longitude === "number"
              ? `${latitude}, ${longitude}`
              : ""),
          latitude,
          longitude,
          provider:
            typeof latitude === "number" && typeof longitude === "number"
              ? "browser"
              : "text",
        }),
      );
      return;
    }

    await onSubmit(value.trim());
  };

  const updateAddress = (key: keyof AddressFormState, nextValue: string) => {
    setAddress((current) => ({ ...current, [key]: nextValue }));
  };

  const updateLocation = (key: keyof LocationFormState, nextValue: string) => {
    setLocation((current) => ({ ...current, [key]: nextValue, error: "" }));
  };

  const useBrowserLocation = () => {
    if (!navigator.geolocation) {
      setLocation((current) => ({
        ...current,
        error: "Browser location is not available.",
      }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation((current) => ({
          ...current,
          error: "",
          label: current.label || "Current location",
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        }));
      },
      () => {
        setLocation((current) => ({
          ...current,
          error: "Could not read browser location.",
        }));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={
        compact ? "flex flex-col gap-2 pt-2" : "flex flex-col gap-2 pt-2"
      }
    >
      {isFileUpload ? (
        <input
          accept={fileAccept}
          className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
          disabled={disabled}
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      ) : isAddress ? (
        <div className="grid gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
            disabled={disabled}
            placeholder="Address line 1"
            value={address.line1}
            onChange={(event) => updateAddress("line1", event.target.value)}
          />
          <input
            className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
            disabled={disabled}
            placeholder="Address line 2"
            value={address.line2}
            onChange={(event) => updateAddress("line2", event.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
              disabled={disabled}
              placeholder="City"
              value={address.city}
              onChange={(event) => updateAddress("city", event.target.value)}
            />
            <input
              className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
              disabled={disabled}
              placeholder="State / Region"
              value={address.region}
              onChange={(event) => updateAddress("region", event.target.value)}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
              disabled={disabled}
              placeholder="Postal code"
              value={address.postalCode}
              onChange={(event) =>
                updateAddress("postalCode", event.target.value)
              }
            />
            <input
              className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
              disabled={disabled}
              placeholder="Country"
              value={address.country}
              onChange={(event) => updateAddress("country", event.target.value)}
            />
          </div>
        </div>
      ) : isLocation ? (
        <div className="grid gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
            disabled={disabled}
            placeholder="Location label or address"
            value={location.label}
            onChange={(event) => updateLocation("label", event.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
              disabled={disabled}
              inputMode="decimal"
              placeholder="Latitude"
              type="number"
              value={location.latitude}
              onChange={(event) =>
                updateLocation("latitude", event.target.value)
              }
            />
            <input
              className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
              disabled={disabled}
              inputMode="decimal"
              placeholder="Longitude"
              type="number"
              value={location.longitude}
              onChange={(event) =>
                updateLocation("longitude", event.target.value)
              }
            />
          </div>
          <button
            className="w-fit rounded-md border bg-white px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-50"
            disabled={disabled}
            type="button"
            onClick={useBrowserLocation}
          >
            Use Current Location
          </button>
          {location.error && (
            <p className="text-xs text-red-700">{location.error}</p>
          )}
        </div>
      ) : (
        <input
          className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
          inputMode={
            inputConfig.inputMode as
              | "decimal"
              | "email"
              | "numeric"
              | "search"
              | "tel"
              | "text"
              | "url"
              | undefined
          }
          placeholder={placeholder}
          step={inputConfig.step}
          type={inputConfig.type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      )}
      <button
        className={
          compact
            ? "inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md bg-black px-3 text-sm font-medium text-white disabled:opacity-50"
            : "inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md bg-black px-3 text-sm font-medium text-white disabled:opacity-50"
        }
        disabled={!canSubmit}
        type="submit"
        aria-label="Submit answer"
      >
        <Send className="h-4 w-4" />
        <span>{isFileUpload ? "Upload" : "Send"}</span>
      </button>
    </form>
  );
}

export function ActionFlowStepOptions({
  step,
  fields = {},
  disabled = false,
  onSelect,
}: ActionFlowStepOptionsProps) {
  const options = getActionStepOptions(step, fields);
  const displayMode = getActionStepChoiceDisplayMode(step);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedProducts, setSelectedProducts] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    const currentStepId = step.id;
    void currentStepId;
    setQuantities({});
    setSelectedProducts({});
  }, [step.id]);

  if (options.length === 0 || displayMode === "text") {
    return null;
  }

  if (step.stepType === "product_selection") {
    const layout = getActionStepProductDisplayLayout(step);
    const allowMultiple = getActionStepProductSelectionAllowMultiple(step);
    const allowQuantity = getActionStepProductSelectionAllowQuantity(step);
    const selectedCartItems = options
      .filter((option) => selectedProducts[String(option.value)])
      .map((option) => {
        const optionValue = String(option.value);

        return {
          productId: option.value,
          quantity: quantities[optionValue] ?? 1,
        };
      });

    return (
      <div className="space-y-2 pt-2">
        <div
          className={
            layout === "grid" ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"
          }
        >
          {options.map((option, index) => {
            const metadata = option.metadata;
            const imageUrl =
              typeof metadata?.imageUrl === "string" ? metadata.imageUrl : "";
            const price = formatOptionPrice(metadata);
            const sku = typeof metadata?.sku === "string" ? metadata.sku : "";
            const isFeatured = layout === "featured" && index === 0;
            const optionValue = String(option.value);
            const quantity = quantities[optionValue] ?? 1;
            const selectValue = allowQuantity
              ? buildProductSelectionAnswerValue(option.value, quantity)
              : optionValue;

            return (
              <div
                className={
                  isFeatured
                    ? "overflow-hidden rounded-md border bg-white text-left text-sm text-gray-900 hover:bg-gray-100"
                    : "flex items-start gap-3 rounded-md border bg-white p-3 text-left text-sm text-gray-900 hover:bg-gray-100"
                }
                key={String(option.value)}
              >
                {imageUrl ? (
                  <span
                    className={
                      isFeatured
                        ? "block aspect-[16/9] w-full border-b bg-cover bg-center"
                        : "h-14 w-14 shrink-0 rounded-md border bg-cover bg-center"
                    }
                    style={{ backgroundImage: `url("${imageUrl}")` }}
                  />
                ) : (
                  <span
                    className={
                      isFeatured
                        ? "flex aspect-[16/9] w-full items-center justify-center border-b bg-gray-50 text-xs font-medium text-gray-500"
                        : "flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-gray-50 text-xs font-medium text-gray-500"
                    }
                  >
                    Item
                  </span>
                )}
                <span className={isFeatured ? "block min-w-0 p-3" : "min-w-0"}>
                  <span className="block font-medium">{option.label}</span>
                  {price && (
                    <span className="block font-semibold">{price}</span>
                  )}
                  {option.description && (
                    <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                  {sku && (
                    <span className="mt-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                      {sku}
                    </span>
                  )}
                </span>
                <span
                  className={
                    isFeatured
                      ? "block space-y-2 px-3 pb-3"
                      : "ml-auto flex shrink-0 flex-col items-end gap-2"
                  }
                >
                  {allowMultiple && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        checked={selectedProducts[optionValue] === true}
                        disabled={disabled}
                        type="checkbox"
                        onChange={(event) =>
                          setSelectedProducts((current) => ({
                            ...current,
                            [optionValue]: event.target.checked,
                          }))
                        }
                      />
                      Add
                    </label>
                  )}
                  {(allowMultiple || allowQuantity) && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Qty
                      <input
                        className="h-8 w-16 rounded-md border bg-white px-2 text-sm text-gray-900"
                        disabled={disabled}
                        min={1}
                        max={999}
                        type="number"
                        value={quantity}
                        onChange={(event) => {
                          const nextQuantity = Number(event.target.value);
                          setQuantities((current) => ({
                            ...current,
                            [optionValue]:
                              Number.isInteger(nextQuantity) && nextQuantity > 0
                                ? Math.min(nextQuantity, 999)
                                : 1,
                          }));
                        }}
                      />
                    </label>
                  )}
                  {!allowMultiple && (
                    <button
                      className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      disabled={disabled}
                      onClick={() => onSelect(selectValue)}
                      type="button"
                    >
                      Select
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {allowMultiple && (
          <button
            className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            disabled={disabled || selectedCartItems.length === 0}
            onClick={() =>
              onSelect(buildProductSelectionCartAnswerValue(selectedCartItems))
            }
            type="button"
          >
            Select {selectedCartItems.length || ""} Item
            {selectedCartItems.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
    );
  }

  if (displayMode === "list") {
    return (
      <div className="flex flex-col gap-2 pt-2">
        {options.map((option, index) => (
          <button
            key={String(option.value)}
            type="button"
            className="flex items-start gap-3 rounded-md border bg-white px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-50"
            onClick={() => onSelect(String(option.value))}
            disabled={disabled}
          >
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs text-white">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{option.label}</span>
              {option.description && (
                <span className="block text-xs text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="rounded-full border bg-white px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-100 disabled:opacity-50"
          onClick={() => onSelect(String(option.value))}
          disabled={disabled}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
