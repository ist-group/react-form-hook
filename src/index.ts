import * as React from "react";

interface FormField<TValue> {
  path: Array<string | number>;
  touched: boolean;
  error: string | undefined | null;
  validating: boolean;
  set: (val: any) => void;
  touch: () => void;
  disabled: boolean;
  rawValue: TValue;
}

export interface PrimitiveField<TValue> extends FormField<TValue> {
  type: "primitive";
  name: string;
  value: TValue;
}

export interface ArrayField<TState extends any[]> extends FormField<TState> {
  type: "array";
  readonly value: Readonly<ConditionalFormField<TState[0]>[]>;
  push: (newValue: TState[0]) => void;
  remove: (index: number) => void;
}

export interface ComplexField<TState extends object> extends FormField<TState> {
  type: "complex";
  readonly value: FormObject<TState>;
}

export type FormObject<TState extends object> = { [P in keyof TState]: Readonly<ConditionalFormField<TState[P]>> };

// Special care to not distribute union types: https://github.com/Microsoft/TypeScript/issues/29368
export type ConditionalFormField<TState> = [TState] extends [any[]]
  ? ArrayField<TState>
  : [TState] extends [boolean | null | undefined | Date]
  ? PrimitiveField<TState>
  : TState extends object
  ? ComplexField<TState>
  : PrimitiveField<TState>;

// This is type is useful when creating reusable "partial" form components that covers some common
// fields of two different forms
export type PartialFormState<TState> = ConditionalFormField<TState> & {
  submitting: boolean;
};

// Legacy name for PartialFormState for backwards compatibility
export type ReadFormState<TState> = PartialFormState<TState>;

export type FormState<TState> = PartialFormState<TState> & {
  submit: () => Promise<void>;
  reset: (newInitialValue?: TState) => void;
};

export interface Validation<TState> {
  onSubmit?: ValidateFunc<TState>;
  onChange?: ValidateFunc<TState>;
}

export interface ComplexValidation<TState extends {}> extends Validation<TState> {
  inner?: ComplexInnerValidation<TState>;
}

export interface ArrayValidation<TState extends any[]> extends Validation<TState> {
  inner?: ConditionalValidation<TState[0]>;
}

export interface PrimitiveValidation<TState> extends Validation<TState> {}

export type ValidateFunc<TValue> = (
  val: TValue,
) => string | undefined | null | false | Promise<string | undefined | null | false>;

export type ConditionalValidation<TState> = [TState] extends [any[]]
  ? ArrayValidation<TState>
  : [TState] extends [boolean | null | undefined | Date]
  ? PrimitiveValidation<TState>
  : [TState] extends object
  ? ComplexValidation<TState>
  : PrimitiveValidation<TState>;

export type ComplexInnerValidation<TState> =
  | {
      [P in keyof TState]?: ConditionalValidation<TState[P]>;
    }
  | undefined;

export type SubmitFunc<TState> = (state: TState) => Promise<any> | void;

function mapValues<T extends object, TResult>(
  obj: T,
  callback: (value: T[keyof T], key: string) => TResult,
): { [P in keyof T]: TResult } {
  return Object.keys(obj).reduce(
    (acc, key: string) => ({ ...acc, [key]: callback(obj[key as keyof T], key) }),
    {} as any,
  );
}

function extractFormFieldValues<T, U extends ConditionalFormField<T>>(field: U): T {
  return visitFormFields(field, {
    array: x => x.value.map(extractFormFieldValues as any),
    complex: x => mapValues(x.value, extractFormFieldValues as any),
    primitive: (x: PrimitiveField<T>) => x.value,
  });
}

function mapFieldsDeep<TValue, F extends ConditionalFormField<TValue>>(
  field: F,
  updater: (prev: FormField<TValue>) => FormField<TValue>,
): TValue {
  return visitFormFields(field, {
    array: (x: ArrayField<TValue & any[]>) => ({
      ...updater(x),
      value: x.value.map((item: any) => mapFieldsDeep(item, updater)),
    }),
    complex: (x: ComplexField<TValue & {}>) => ({
      ...updater(x),
      value: mapValues(x.value, innerField => mapFieldsDeep(innerField as any, updater)),
    }),
    primitive: (x: PrimitiveField<TValue>) => updater(x),
  });
}

async function validateValue<TValue, TState extends ConditionalFormField<TValue>>(
  value: TState,
  validator?: ConditionalValidation<TValue> | undefined,
) {
  if (validator) {
    // First check onChange
    if (validator.onChange) {
      const validationError = await validator.onChange(extractFormFieldValues(value as any));
      if (validationError) {
        return validationError;
      }
    }
    // If ok, do the onSubmit validation
    if (validator.onSubmit) {
      return validator.onSubmit(extractFormFieldValues(value as any));
    }
  }
}

async function mergeInValidationResults<TValue, TField extends ConditionalFormField<TValue>>(
  field: TField,
  validators?: ConditionalValidation<TValue>,
): Promise<any> {
  // Do not anything if we do not have any specified validators
  if (!validators) {
    return field;
  }
  return visitFormFields<TValue, TField>(field, {
    array: async x => ({
      ...x,
      value: await Promise.all(
        x.value.map(item =>
          mergeInValidationResults(item as any, validators && (validators as ArrayValidation<TValue & any[]>).inner),
        ),
      ),
      error: await validateValue(x as any, validators),
    }),
    complex: async x => ({
      ...x,
      value: await Promise.all(
        Object.keys(x.value).map(async key => [
          key,
          await mergeInValidationResults(
            (x.value as any)[key],
            validators && (validators as ComplexValidation<TValue>).inner ? (validators as any).inner[key] : undefined,
          ),
        ]),
      ).then((res: any) => res.reduce((acc: any, [key, value]: any) => ({ ...acc, [key]: value }), {})),
      error: await validateValue(x as any, validators),
    }),
    primitive: async innerField => ({
      ...innerField,
      error: await validateValue(innerField as ConditionalFormField<TValue>, validators),
    }),
  });
}

interface Visitor<TValue> {
  array: (field: ArrayField<TValue & any[]>) => any;
  complex: (field: ComplexField<TValue & object>) => any;
  primitive: (field: PrimitiveField<TValue>) => any;
}

function visitFormFields<TValue, TField extends ConditionalFormField<TValue>>(
  field: TField,
  visitor: Visitor<TValue>,
): any {
  if (field.type === "array") {
    return visitor.array(field as ArrayField<TValue & any[]>);
  } else if (field.type === "primitive") {
    return visitor.primitive(field as PrimitiveField<TValue>);
  } else {
    return visitor.complex(field as ComplexField<TValue & object>);
  }
}

function containsError<T>(field: ConditionalFormField<T>): boolean {
  if (field.error) {
    return true;
  }
  if (field.type === "array" && field && field.value) {
    return ((field as unknown) as ArrayField<T & any[]>).value.some(containsError);
  } else if (field.type === "complex" && field && field.value) {
    return Object.keys(field.value).some(key => containsError((field as any).value[key as any]));
  }
  return false;
}

export interface FormOptions<TState> {
  onSubmit: SubmitFunc<TState>;
  validation?: ConditionalValidation<TState>;
}

export function useForm<TState>(initState: TState, options: FormOptions<TState>): FormState<TState> {
  const stateRef = React.useRef<FormState<TState>>();
  const submitRef = React.useRef<SubmitFunc<TState>>();

  let setState: (updater: (prev: FormState<TState>) => FormState<TState>) => void;
  let state: FormState<TState>;

  [state, setState] = React.useState<FormState<TState>>(() => {
    const updateState = (updater: (fields: any) => any) => {
      setState(oldState => {
        return { ...oldState, ...updater(oldState) };
      });
    };

    const getState = () => stateRef.current!;

    return {
      ...createFormField(initState, [], options.validation, updateState),
      submitting: false,
      reset: (newState?: TState) =>
        setState(prev => ({
          ...prev,
          ...createFormField(newState || initState, [], options.validation, updateState),
        })),
      submit: async () => {
        if (stateRef.current!.submitting) {
          return;
        }
        // Better keep current state in a local variable instead of trusting state ref to be up-to-date
        let currentState = stateRef.current!;
        const replaceState = (newState: FormState<TState>) => {
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
            await mergeInValidationResults<TState, FormState<TState>>(currentState, options.validation),
          );

          // Submit if no error
          if (!containsError(currentState as any)) {
            await submitRef.current!(extractFormFieldValues(currentState));
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
    submitRef.current = options.onSubmit;
    return () => {
      stateRef.current = undefined;
      submitRef.current = undefined;
    };
  });

  return state;
}

function getValdator<TValue>(
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
  validator?: ConditionalValidation<TValue>,
) {
  return (newValue: TValue) => {
    const valResult: any = validator && validator.onChange ? validator.onChange(newValue) : undefined;

    if (valResult && valResult.then && valResult.catch) {
      valResult
        .then((res: any) => {
          setter(prev => (newValue === prev.value ? { ...prev, error: res, validating: false } : prev));
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
  validation: ConditionalValidation<TValue> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): ConditionalFormField<TValue> {
  if (Array.isArray(initValue)) {
    return createArrayFormField(initValue, path, validation as any, setter as any) as ConditionalFormField<TValue>;
    // Consider null and Date to be primitive fields
  } else if (typeof initValue === "object" && initValue !== null && !(initValue instanceof Date)) {
    return (createComplexFormField(
      initValue as TValue & object,
      path,
      validation as any,
      setter as any,
    ) as unknown) as ConditionalFormField<TValue>;
  } else {
    return createPrimitiveFormField(initValue, path, validation, setter) as ConditionalFormField<TValue>;
  }
}

function createArrayFormField<TValue extends any[]>(
  initValue: TValue,
  path: Array<string | number>,
  validation: ArrayValidation<TValue> | undefined,
  setter: (updater: (prev: ArrayField<TValue>) => ArrayField<TValue>) => void,
): ArrayField<TValue> {
  const executeValidation = getValdator(setter as any, validation as ConditionalValidation<TValue>);
  const setterWithValidation = (originalUpdater: (prev: ArrayField<TValue>) => ArrayField<TValue>) => {
    if (validation && validation.onChange) {
      setter(field => {
        const val = originalUpdater(field);
        return { ...val, ...executeValidation(extractFormFieldValues(val as any)) };
      });
    } else {
      setter(originalUpdater);
    }
  };

  const createFormFieldInArray = <T>(val: T, index: number) =>
    createFormField(val, [...path, index], validation && validation.inner, updater =>
      setterWithValidation(prev => ({
        ...prev,
        value: prev.value.map((prevValue: any, prevIndex) =>
          index === prevIndex ? updater(prevValue) : prevValue,
        ) as any,
        rawValue: prev.rawValue.map((prevRawValue: any, prevRawIndex) =>
          index === prevRawIndex ? val : prevRawValue,
        ) as any,
      })),
    ) as ConditionalFormField<TValue[0]>;

  const setValue = (newValue: TValue) => {
    setter(prev => ({
      ...prev,
      touched: true,
      value: newValue.map(createFormFieldInArray),
      rawValue: newValue,
      ...executeValidation(newValue),
    }));
  };

  const setTouched = () =>
    setter(prev => ({
      ...prev,
      touched: true,
      ...executeValidation(prev.value as any),
    }));

  return {
    ...getBasicField(path, setValue, setTouched, initValue),
    type: "array",
    value: initValue.map(createFormFieldInArray),
    remove: (index: number) =>
      setterWithValidation(prev => ({ ...prev, touched: true, value: prev.value.filter((__, i) => i !== index) })),
    push: (newEntry: TValue[0]) =>
      setterWithValidation(prev => ({
        ...prev,
        touched: true,
        value: [...prev.value, createFormFieldInArray(newEntry, prev.value.length)],
      })),
  };
}

function createComplexFormFieldValues<TObject extends object>(
  value: TObject,
  path: Array<string | number>,
  objectValidation: ComplexInnerValidation<TObject> | undefined,
  setter: (updater: (prev: ConditionalFormField<TObject>) => ConditionalFormField<TObject>) => void,
): FormObject<TObject> {
  return mapValues(value, (val, key) =>
    createFormField(
      val,
      [...path, key],
      ((objectValidation ? objectValidation : {}) as any)[key],
      updater =>
        setter(
          prev =>
            ({
              ...prev,
              [key]: updater(((prev || {}) as any)[key]),
            } as any),
        ) as any,
    ),
  ) as any;
}

function createComplexFormField<TValue extends object>(
  initValue: TValue,
  path: Array<string | number>,
  objectValidation: ComplexValidation<TValue> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): ComplexField<TValue> {
  const executeValidation = getValdator(setter, objectValidation as any);
  const childDataValidation = (value: any) => {
    if (objectValidation && objectValidation.onChange) {
      return executeValidation(extractFormFieldValues(value));
    }
    return {};
  };

  const createNestedValueFromValue = (newValue: TValue) =>
    createComplexFormFieldValues(
      newValue,
      path,
      objectValidation ? objectValidation.inner : undefined,
      updater =>
        setter(prev => {
          const value = {
            ...prev,
            value: updater(((prev || {}) as any).value),
          };
          return {
            ...value,
            ...childDataValidation(value),
          };
        }) as any,
    );

  const setValue = (newValue: TValue) =>
    setter(prev => ({
      ...prev,
      value: newValue !== null ? createNestedValueFromValue(newValue) : null,
      rawValue: newValue,
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
    value: createNestedValueFromValue(initValue),
  };
}

function createPrimitiveFormField<TValue>(
  initValue: TValue,
  path: Array<string | number>,
  validate: ConditionalValidation<TValue> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): PrimitiveField<TValue> {
  const executeValidation = getValdator(setter, validate);

  const setValue = (newValue: TValue) => {
    setter(prev => {
      // Tranform a primitive field to a complex fied (prop.field == null => prop.field == {})
      if (
        newValue !== null &&
        !(newValue instanceof Date) &&
        (!prev || prev.value === null || prev.value === undefined) &&
        typeof newValue === "object"
      ) {
        return createComplexFormField(
          newValue as any,
          path,
          validate && (validate as ComplexValidation<TValue & {}>).inner,
          setter as any,
        ) as any;
      } else {
        return {
          ...prev,
          value: newValue,
          rawValue: newValue,
          ...executeValidation(newValue),
        };
      }
    });
  };

  const setTouched = () =>
    setter(prev => ({
      ...prev,
      touched: true,
      ...(prev && prev.value ? executeValidation(prev.value as any) : {}),
    }));

  return {
    ...getBasicField(path, setValue, setTouched, initValue),
    type: "primitive",
    name: pathToString(path),
    value: initValue,
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
  rawValue: T,
): FormField<T> {
  return {
    path,
    touched: false,
    error: undefined,
    validating: false,
    disabled: false,
    set,
    touch,
    rawValue,
  };
}
