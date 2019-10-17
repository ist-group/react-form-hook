import * as React from "react";

interface FormField {
  path: Array<string | number>;
  touched: boolean;
  error: string | undefined | null;
  validating: boolean;
  set: (val: any) => void;
}

export interface PrimitiveField<TValue> extends FormField {
  type: "primitive";
  props: {
    name: string;
    disabled: boolean;
    onChange: (ev: React.ChangeEvent<any>) => void;
    onBlur: () => void;
  };
  value: TValue;
}

export interface ArrayField<TState extends any[]> extends FormField {
  type: "array";
  readonly value: Readonly<ConditionalFormField<TState[0]>[]>;
  push: (newValue: TState[0]) => void;
  remove: (index: number) => void;
}

export interface ComplexField<TState extends object> extends FormField {
  type: "complex";
  readonly value: FormObject<TState>;
}

export type FormObject<TState extends object> = { [P in keyof TState]: Readonly<ConditionalFormField<TState[P]>> };

// Special care to not distribute union types: https://github.com/Microsoft/TypeScript/issues/29368
export type ConditionalFormField<TState> = [TState] extends [any[]]
  ? ArrayField<TState>
  : [TState] extends [boolean | null | undefined]
  ? PrimitiveField<TState>
  : TState extends object
  ? ComplexField<TState>
  : PrimitiveField<TState>;

export interface ReadFormState<TState> {
  submit: () => Promise<void>;
  reset: (newInitialValue?: TState) => void;
  submitting: boolean;
}

export type FormState<TState> = ConditionalFormField<TState> & ReadFormState<TState>;

interface ComplexValidation<TState extends {}> {
  inner?: FieldValidation<TState>;
  onSubmit?: FieldValidateFunc<TState>;
  onChange?: FieldValidateFunc<TState>;
}

interface ArrayValidation<TState extends any[]> {
  inner?: ConditionalFieldValidation<TState[0]>;
  onSubmit?: FieldValidateFunc<TState>;
  onChange?: FieldValidateFunc<TState>;
}
interface PrimitiveValidation<TState> {
  onSubmit?: FieldValidateFunc<TState>;
  onChange?: FieldValidateFunc<TState>;
}

type FieldValidateFunc<TValue> = (
  val: TValue,
) => string | undefined | null | false | Promise<string | undefined | null | false>;

type ConditionalFieldValidation<TState> = [TState] extends [any[]]
  ? ArrayValidation<TState>
  : [TState] extends [boolean | null | undefined]
  ? PrimitiveValidation<TState>
  : [TState] extends object
  ? ComplexValidation<TState>
  : PrimitiveValidation<TState>;

type FieldValidation<TState> =
  | {
      [P in keyof TState]?: ConditionalFieldValidation<TState[P]>;
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

function mapFormFields<TValue, F extends ConditionalFormField<TValue>>(
  field: F,
  updater: (prev: PrimitiveField<any>) => PrimitiveField<any>,
): TValue {
  return visitFormFields(field, {
    array: (x: ArrayField<TValue & any[]>) => ({
      ...x,
      value: x.value.map((item: any) => mapFormFields(item, updater)),
    }),
    complex: (x: ComplexField<TValue & {}>) => ({
      ...x,
      value: mapValues(x.value, innerField => mapFormFields(innerField as any, updater)),
    }),
    primitive: (y: PrimitiveField<TValue>) => updater(y),
  });
}

async function validateValue<TValue, TState extends ConditionalFormField<TValue>>(
  value: TState,
  validator?: ConditionalFieldValidation<TValue> | undefined,
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
  validators?: ConditionalFieldValidation<TValue>,
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
  validation?: ConditionalFieldValidation<TState>;
}

export function useForm<TState>(initState: TState, options: FormOptions<TState>): FormState<TState> {
  const stateRef = React.useRef<FormState<TState>>();
  const submitRef = React.useRef<SubmitFunc<TState>>();

  let setState: (updater: (prev: FormState<TState>) => FormState<TState>) => void;
  let state: FormState<TState>;

  [state, setState] = React.useState<FormState<TState>>(() => {
    const fieldsUpdater = (updater: (fields: any) => any) => {
      setState(oldValue => {
        return { ...state, ...updater(oldValue) };
      });
    };

    return {
      ...createFormField(initState, [], options.validation, fieldsUpdater),
      submitting: false,
      reset: (newState?: TState) =>
        setState(prev => ({
          ...prev,
          ...createFormField(newState || initState, [], options.validation, fieldsUpdater),
        })),
      submit: async () => {
        if (stateRef.current!.submitting) {
          return;
        }
        // Better keep current state in a local variable instead of trusting state ref to be up-to-date
        let currentState = stateRef.current!;
        const updateState = (newState: FormState<TState>) => {
          setState(() => newState);
          return newState;
        };
        try {
          // Touch all, disable all and set submitting
          currentState = updateState({
            ...currentState,
            ...mapFormFields(currentState as any, value => ({
              ...value,
              props: { ...value.props, disabled: true },
              touched: true,
            })),
            submitting: true,
          });

          currentState = updateState(
            await mergeInValidationResults<TState, FormState<TState>>(currentState, options.validation),
          );

          // Submit if no error
          if (!containsError(currentState as any)) {
            await submitRef.current!(extractFormFieldValues(currentState));
            // "Un-touch" all
            setState(prev => ({
              ...prev,
              ...mapFormFields(prev as any, value => ({
                ...value,
                touched: false,
              })),
            }));
          }
        } finally {
          setState(prev => ({
            ...prev,
            ...mapFormFields(prev as any, value => ({
              ...value,
              props: { ...value.props, disabled: false },
            })),
            submitting: false,
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
  validator?: ConditionalFieldValidation<TValue>,
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
  validation: ConditionalFieldValidation<TValue> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): ConditionalFormField<TValue> {
  if (Array.isArray(initValue)) {
    return createArrayFormField(initValue, path, validation, setter as any) as ConditionalFormField<TValue>;
    // Consider null to be a primitive field
  } else if (typeof initValue === "object" && initValue !== null) {
    return (createComplexFormField(
      initValue as TValue & object,
      path,
      validation as ComplexValidation<TValue & object>,
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
  const executeValidation = getValdator(setter as any, validation as ConditionalFieldValidation<TValue>);
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
      })),
    ) as ConditionalFormField<TValue[0]>;

  const setValue = (newValue: TValue) => {
    setter(prev => ({
      ...prev,
      touched: true,
      value: newValue.map(createFormFieldInArray),
      ...executeValidation(newValue),
    }));
  };

  return {
    ...getBasicField(path, setValue),
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
  object: TObject,
  path: Array<string | number>,
  objectValidation: FieldValidation<TObject> | undefined,
  setter: (updater: (prev: ConditionalFormField<TObject>) => ConditionalFormField<TObject>) => void,
): FormObject<TObject> {
  return mapValues(object, (val, key) =>
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

  const getFieldsFromValue = (newValue: TValue) =>
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
      value: newValue !== null ? getFieldsFromValue(newValue) : null,
      ...executeValidation(newValue),
    }));

  return {
    ...getBasicField(path, setValue),
    type: "complex",
    value: getFieldsFromValue(initValue),
  };
}

function createPrimitiveFormField<TValue>(
  initValue: TValue,
  path: Array<string | number>,
  validate: ConditionalFieldValidation<TValue> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): PrimitiveField<TValue> {
  const executeValidation = getValdator(setter, validate);

  const setValue = (newValue: TValue) => {
    setter(prev => {
      // Tranform a primitive field to a complex fied (prop.field == null => prop.field == {})
      if (
        newValue !== null &&
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
          ...executeValidation(newValue),
        };
      }
    });
  };

  return {
    ...getBasicField(path, setValue),
    type: "primitive",
    props: {
      name: pathToString(path),
      disabled: false,
      onChange: ev => setValue(ev.target.value),
      onBlur: () =>
        setter(prev => ({
          ...prev,
          touched: true,
          ...(prev && prev.value ? executeValidation(prev.value as any) : {}),
        })),
    },
    value: initValue,
  };
}

function pathToString(path: Array<string | number>): string {
  const [firstElement, ...theRest] = path;
  return theRest.reduce(
    (pathString: string, value: string | number) => {
      return `${pathString}[${value}]`;
    },
    firstElement as string,
  );
}

function getBasicField<T>(path: Array<string | number>, set: (val: T) => void): FormField {
  return {
    path,
    touched: false,
    error: undefined,
    validating: false,
    set,
  };
}
