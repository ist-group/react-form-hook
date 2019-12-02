import * as React from "react";

interface FormField<TValue, TValidationError = string> {
  name: string;
  path: Array<string | number>;
  touched: boolean;
  error: TValidationError | undefined;
  validating: boolean;
  set: (val: any) => void;
  touch: () => void;
  disabled: boolean;
  value: TValue;
}

export interface PrimitiveField<TValue, TValidationError = string> extends FormField<TValue, TValidationError> {
  type: "primitive";
}

// This is a "fake" specialized primitive field type that is here to teach TypeScript manners (TS 3.7.2)
export interface NullPrimitiveField<TState, TValidationError = string> extends FormField<TState, TValidationError> {
  type: "primitive";
  readonly fields?: undefined;
}

export interface ArrayField<TState extends any[], TValidationError = string>
  extends FormField<TState, TValidationError> {
  type: "array";
  readonly items: Readonly<ConditionalFormField<TState[0], TValidationError>[]>;
  push: (newValue: TState[0]) => void;
  remove: (index: number) => void;
}

export interface ComplexField<TState extends object, TValidationError = string>
  extends FormField<TState, TValidationError> {
  type: "complex";
  readonly fields: FormFields<TState, TValidationError>;
}

export type FormFields<TState extends object, TValidationError = string> = {
  [P in keyof TState]: Readonly<ConditionalFormField<TState[P], TValidationError>>;
};

// Special care to not distribute union types: https://github.com/Microsoft/TypeScript/issues/29368
export type ConditionalFormField<TState, TValidationError = string> = TState extends null | undefined
  ? NullPrimitiveField<TState, TValidationError>
  : [TState] extends [any[]]
  ? ArrayField<TState, TValidationError>
  : [TState] extends [boolean | Date]
  ? PrimitiveField<TState, TValidationError>
  : [TState] extends [object]
  ? ComplexField<TState, TValidationError>
  : PrimitiveField<TState, TValidationError>;

// This is type is useful when creating reusable "partial" form components that covers some common
// fields of two different forms
export type PartialFormState<TState, TValidationError = string> = ConditionalFormField<TState, TValidationError> & {
  submitting: boolean;
};

// Legacy name for PartialFormState for backwards compatibility
export type ReadFormState<TState, TValidationError = string> = PartialFormState<TState, TValidationError>;

export type FormState<TState, TValidationError = string> = PartialFormState<TState, TValidationError> & {
  submit: () => Promise<void>;
};

export interface Validation<TState, TValidationError = string> {
  onSubmit?: ValidateFunc<TState, TValidationError>;
  onChange?: ValidateFunc<TState, TValidationError>;
}

export interface ComplexValidation<TState extends {}, TValidationError = string>
  extends Validation<TState, TValidationError> {
  fields?: ComplexFieldsValidation<TState, TValidationError>;
}

export interface ArrayValidation<TState extends any[], TValidationError = string>
  extends Validation<TState, TValidationError> {
  item?: ConditionalValidation<TState[0], TValidationError>;
}

export interface PrimitiveValidation<TState, TValidationError = string> extends Validation<TState, TValidationError> {}

export type ValidateFunc<TValue, TValidationError = string> = (
  val: TValue,
) => TValidationError | false | undefined | null | Promise<TValidationError | undefined | false | null>;

export type ConditionalValidation<TState, TValidationError = string> = TState extends null | undefined
  ? null
  : [TState] extends [any[]]
  ? ArrayValidation<TState, TValidationError>
  : [TState] extends [boolean | Date]
  ? PrimitiveValidation<TState, TValidationError>
  : [TState] extends [object]
  ? ComplexValidation<TState, TValidationError>
  : PrimitiveValidation<TState, TValidationError>;

export type ComplexFieldsValidation<TState, TValidationError = string> =
  | {
      [P in keyof TState]?: ConditionalValidation<TState[P], TValidationError>;
    }
  | undefined;

export type SubmitFunc<TState> = (state: TState) => Promise<any> | void;

function mapValues<T extends object, TResult>(
  obj: T,
  callback: (value: T[keyof T], key: keyof T) => TResult,
): { [P in keyof T]: TResult } {
  return (Object.keys(obj) as (keyof T)[]).reduce(
    (acc, key) => ({ ...acc, [key]: callback(obj[key], key) }),
    {} as any,
  );
}

function mapFieldsDeep<TValue, F extends ConditionalFormField<TValue, TValidationError>, TValidationError>(
  field: F,
  updater: (prev: FormField<TValue, TValidationError>) => FormField<TValue, TValidationError>,
): TValue {
  return visitFormFields(field, {
    array: (x: ArrayField<TValue & any[], TValidationError>) => ({
      ...updater(x),
      items: x.items.map((item: any) => mapFieldsDeep(item, updater)),
    }),
    complex: (x: ComplexField<TValue & {}, TValidationError>) => ({
      ...updater(x),
      fields: mapValues(x.fields, innerField => mapFieldsDeep(innerField as any, updater)),
    }),
    primitive: (x: PrimitiveField<TValue, TValidationError>) => updater(x),
  });
}

async function validateValue<TValue, TValidationError>(
  value: TValue,
  validator?: ConditionalValidation<TValue, TValidationError> | undefined,
): Promise<TValidationError | undefined> {
  if (validator) {
    // First check onChange
    if (validator.onChange) {
      const validationError = await validator.onChange(value);
      if (validationError) {
        return validationError;
      }
    }
    // If ok, do the onSubmit validation
    if (validator.onSubmit) {
      const validationError = await validator.onSubmit(value);
      if (validationError) {
        return validationError;
      }
    }
  }

  return undefined!;
}

async function mergeInValidationResults<TValue, TField extends ConditionalFormField<TValue, any>>(
  field: TField,
  validators?: ConditionalValidation<TValue, any>,
): Promise<any> {
  // Do not anything if we do not have any specified validators
  if (!validators) {
    return field;
  }
  return visitFormFields<TValue, TField>(field, {
    array: async (x): Promise<ArrayField<any, any>> => ({
      ...x,
      items: await Promise.all(
        x.items.map((item: any) =>
          mergeInValidationResults(
            item as any,
            validators && (validators as ArrayValidation<TValue & any[], any>).item,
          ),
        ),
      ),
      error: await validateValue(x.value, validators),
    }),
    complex: async (x): Promise<ComplexField<any, any>> => ({
      ...x,
      fields: await Promise.all(
        Object.keys(x.fields).map(async key => [
          key,
          await mergeInValidationResults(
            (x.fields as any)[key],
            validators && (validators as ComplexValidation<TValue, any>).fields
              ? ((validators as ComplexValidation<TValue, any>).fields as any)[key]
              : undefined,
          ),
        ]),
      ).then((res: any) => res.reduce((acc: any, [key, value]: any) => ({ ...acc, [key]: value }), {})),
      error: await validateValue(x.value, validators),
    }),
    primitive: async (innerField): Promise<PrimitiveField<any, any>> => ({
      ...innerField,
      error: await validateValue(innerField.value, validators),
    }),
  });
}

interface Visitor<TValue> {
  array: (field: ArrayField<TValue & any[], any>) => any;
  complex: (field: ComplexField<TValue & object, any>) => any;
  primitive: (field: PrimitiveField<TValue, any>) => any;
}

function visitFormFields<TValue, TField extends ConditionalFormField<TValue, any>>(
  field: TField,
  visitor: Visitor<TValue>,
): any {
  if (field.type === "array") {
    return visitor.array(field as ArrayField<TValue & any[], any>);
  } else if (field.type === "primitive") {
    return visitor.primitive(field as PrimitiveField<TValue, any>);
  } else {
    return visitor.complex(field as ComplexField<TValue & object, any>);
  }
}

function containsError<T>(field: ConditionalFormField<T, any>): boolean {
  if (field.error) {
    return true;
  }
  if (field.type === "array") {
    return (field as ArrayField<any, any>).items.some(containsError);
  } else if (field.type === "complex") {
    return Object.keys((field as ComplexField<any, any>).fields).some(key =>
      containsError((field as any).fields[key as any]),
    );
  }
  return false;
}

export interface FormOptions<TState, TValidationError = string> {
  onSubmit: SubmitFunc<TState>;
  validation?: ConditionalValidation<TState, TValidationError>;
}

export function useForm<TState, TValidationError = string>(
  initState: TState,
  options: FormOptions<TState, TValidationError>,
): FormState<TState, TValidationError> {
  const stateRef = React.useRef<FormState<TState, TValidationError>>();
  const optionsRef = React.useRef<FormOptions<TState, TValidationError>>();

  let setState: (updater: (prev: FormState<TState, TValidationError>) => FormState<TState, TValidationError>) => void;
  let state: FormState<TState, TValidationError>;

  [state, setState] = React.useState<FormState<TState, TValidationError>>(() => {
    const updateState = (updater: (fields: ConditionalFormField<TState, TValidationError>) => any) => {
      setState(oldState => {
        return { ...oldState, ...updater(oldState) };
      });
    };

    return {
      ...createFormField(initState, [], () => optionsRef.current!.validation, updateState),
      submitting: false,

      submit: async () => {
        if (stateRef.current!.submitting) {
          return;
        }
        // Better keep current state in a local variable instead of trusting state ref to be up-to-date
        let currentState = stateRef.current!;
        const replaceState = (newState: FormState<TState, TValidationError>) => {
          setState(() => newState);
          return newState;
        };
        try {
          // Touch all, disable all and set submitting
          currentState = replaceState({
            ...currentState,
            ...mapFieldsDeep(currentState as any, value => ({
              ...value,
              disabled: true,
              touched: true,
            })),
            submitting: true,
            disabled: true,
          });

          currentState = replaceState(
            await mergeInValidationResults<TState, FormState<TState, TValidationError>>(
              currentState,
              optionsRef.current!.validation,
            ),
          );

          // Submit if no error
          if (!containsError(currentState as any)) {
            await optionsRef.current!.onSubmit(currentState.value);
            // "Un-touch" all
            setState(prev => ({
              ...prev,
              ...mapFieldsDeep(prev as any, value => ({
                ...value,
                touched: false,
              })),
            }));
          }
        } finally {
          setState(prev => ({
            ...prev,
            ...mapFieldsDeep(prev as any, value => ({
              ...value,
              disabled: false,
            })),
            submitting: false,
            disabled: false,
          }));
        }
      },
    };
  });

  React.useEffect(() => {
    stateRef.current = state;
    optionsRef.current = options;
    return () => {
      stateRef.current = undefined;
      optionsRef.current = undefined;
    };
  });

  return state;
}

function getOnChangeValidator<TValue>(
  setter: (updater: (prev: ConditionalFormField<TValue, any>) => ConditionalFormField<TValue, any>) => void,
  validatorFetcher: () => ConditionalValidation<TValue, any> | undefined,
) {
  return (newValue: TValue) => {
    const validator = validatorFetcher();
    const valResult: any = validator && validator.onChange ? validator.onChange(newValue) : undefined;

    if (valResult && valResult.then && valResult.catch) {
      // TODO better checks if return values should be given
      valResult
        .then((res: any) => {
          setter(prev => (newValue === prev.value ? { ...prev, error: res || undefined, validating: false } : prev));
        })
        .catch(() =>
          setter(prev => (newValue === prev.value ? { ...prev, error: "Validation failed", validating: false } : prev)),
        );
      return { validating: true };
    }
    return { error: valResult, validating: false };
  };
}

function createFormField<TValue>(
  initValue: TValue,
  path: Array<string | number>,
  validationFetcher: () => ConditionalValidation<TValue, any> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue, any>) => ConditionalFormField<TValue, any>) => void,
): ConditionalFormField<TValue, any> {
  if (Array.isArray(initValue)) {
    return createArrayFormField(initValue, path, validationFetcher as any, setter as any) as ConditionalFormField<
      TValue,
      any
    >;
    // Consider null and Date to be primitive fields
  } else if (typeof initValue === "object" && initValue !== null && !(initValue instanceof Date)) {
    return (createComplexField(
      initValue as TValue & object,
      path,
      validationFetcher as any,
      setter as any,
    ) as unknown) as ConditionalFormField<TValue, any>;
  } else {
    return createPrimitiveFormField(initValue, path, validationFetcher, setter) as ConditionalFormField<TValue, any>;
  }
}

function createArrayFormField<TValue extends any[]>(
  initValue: TValue,
  path: Array<string | number>,
  validatorFetcher: () => ArrayValidation<TValue, any> | undefined,
  setter: (updater: (prev: ArrayField<TValue, any>) => ArrayField<TValue, any>) => void,
): ArrayField<TValue, any> {
  const executeValidation = getOnChangeValidator(setter as any, validatorFetcher as any);

  const createFieldForItem = <T>(val: T, index: number) =>
    createFormField(
      val,
      [...path, index],
      () => (validatorFetcher() || {}).item,
      updater =>
        setter(prev => {
          const items = prev.items.map((prevValue, prevIndex) =>
            index === prevIndex ? updater(prevValue) : prevValue,
          );
          const value = items.map(x => x.value) as TValue;
          return {
            ...prev,
            items,
            value,
            touched: true,
            ...executeValidation(value),
          };
        }),
    ) as ConditionalFormField<TValue[0], any>;

  const setValue = (newValue: TValue) => {
    setter(prev => ({
      ...prev,
      touched: true,
      items: newValue.map(createFieldForItem),
      value: newValue,
      ...executeValidation(newValue),
    }));
  };

  const setTouched = () =>
    setter(prev => ({
      ...prev,
      touched: true,
      ...executeValidation(prev.items as any),
    }));

  return {
    ...getBasicField(path, setValue, setTouched, initValue),
    type: "array",
    items: initValue.map(createFieldForItem),
    remove: (index: number) =>
      setter(prev => {
        const items = prev.items.filter((_, i) => i !== index).map((val, i) => createFieldForItem(val.value, i));
        const value = items.map(x => x.value);
        return {
          ...prev,
          touched: true,
          items,
          value,
          ...executeValidation(value),
        } as any;
      }),
    push: (newEntry: TValue[0]) =>
      setter(prev => {
        const items = [...prev.items, createFieldForItem(newEntry, prev.items.length)];
        const value = items.map(x => x.value);
        return {
          ...prev,
          touched: true,
          items,
          value,
          ...executeValidation(value),
        } as any;
      }),
  };
}

function createFormFields<TObject extends object>(
  value: TObject,
  path: Array<string | number>,
  validationFetcher: () => ComplexFieldsValidation<TObject, any> | undefined,
  setter: (updater: (prev: FormFields<TObject, any>) => FormFields<TObject, any>) => void,
): FormFields<TObject, any> {
  return mapValues(value, (val, key) =>
    createFormField(
      val,
      [...path, key as string | number],
      () => (validationFetcher() || ({} as any))[key],
      updater =>
        setter(prev => ({
          ...prev,
          [key]: updater(((prev || {}) as any)[key]),
        })),
    ),
  ) as any;
}

function createComplexField<TValue extends object>(
  initValue: TValue,
  path: Array<string | number>,
  validationFetcher: () => ComplexValidation<TValue, any> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue, any>) => ConditionalFormField<TValue, any>) => void,
): ComplexField<TValue, any> {
  const executeValidation = getOnChangeValidator(setter, validationFetcher as any);

  const createFormFieldsByValue = (newValue: TValue) =>
    createFormFields(
      newValue,
      path,
      () => (validationFetcher() || {}).fields,
      updater =>
        setter(prev => {
          const fields = updater(prev ? prev.fields : ({} as any));
          const value = mapValues(fields, v => v.value);
          return {
            ...prev,
            fields,
            value,
            touched: true,
            ...executeValidation(value as any),
          };
        }) as any,
    );

  const setValue = (newValue: TValue) =>
    setter(prev => ({
      ...prev,
      fields: newValue !== null ? createFormFieldsByValue(newValue) : null,
      value: newValue,
      touched: true,
      ...executeValidation(newValue),
    }));

  const setTouched = () =>
    setter(prev => ({
      ...prev,
      touched: true,
      ...executeValidation(prev.value as any),
    }));

  return {
    ...getBasicField(path, setValue, setTouched, initValue),
    type: "complex",
    fields: createFormFieldsByValue(initValue),
  };
}

function createPrimitiveFormField<TValue>(
  initValue: TValue,
  path: Array<string | number>,
  validationFetcher: () => ConditionalValidation<TValue, any> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue, any>) => ConditionalFormField<TValue, any>) => void,
): PrimitiveField<TValue, any> {
  const executeValidation = getOnChangeValidator(setter, validationFetcher);

  const setValue = (newValue: TValue) => {
    setter(prev => {
      // Tranform a primitive field to a complex fied (prop.field == null => prop.field == {})
      if (newValue !== null && !(newValue instanceof Date) && prev.type !== "complex" && typeof newValue === "object") {
        return createComplexField(newValue as any, path, validationFetcher as any, setter as any) as any;
      } else {
        return {
          ...prev,
          value: newValue,
          ...executeValidation(newValue),
        };
      }
    });
  };

  const setTouched = () =>
    setter(prev => ({
      ...prev,
      touched: true,
      ...executeValidation(prev.value as any),
    }));

  return {
    ...getBasicField(path, setValue, setTouched, initValue),
    type: "primitive",
  };
}

function pathToString(path: Array<string | number>): string {
  const [firstElement, ...theRest] = path;
  return theRest.reduce((pathString: string, value: string | number) => {
    return `${pathString}[${value}]`;
  }, firstElement as string);
}

function getBasicField<T>(
  path: Array<string | number>,
  set: (val: T) => void,
  touch: () => void,
  value: T,
): FormField<T, any> {
  return {
    name: pathToString(path),
    path,
    touched: false,
    error: undefined,
    validating: false,
    disabled: false,
    set,
    touch,
    value,
  };
}
