import * as React from "react";

interface FormField {
  path: Array<string | number>;
  touched: boolean;
  error: string | undefined | null;
  validating: boolean;
  set: (val: any) => void;
}

export type PrimitiveFormField<TValue> = FormField & {
  type: "primitive";
  props: {
    name: string;
    disabled: boolean;
    onChange: (ev: React.ChangeEvent<any>) => void;
    onBlur: () => void;
  };
  value: TValue;
};

export type ArrayFormField<TState extends any[]> = FormField & {
  type: "array";
  readonly value: Readonly<ConditionalFormField<TState[0]>[]>;
  push: (newValue: TState[0]) => void;
  remove: (index: number) => void;
};

export type ComplexFormField<TState extends object> = FormField & {
  type: "complex";
  readonly value: FormObject<TState>;
};

export type FormObject<TState extends object> = { [P in keyof TState]: Readonly<ConditionalFormField<TState[P]>> };

// Special care to not distribute union types: https://github.com/Microsoft/TypeScript/issues/29368
export type ConditionalFormField<TState> = [TState] extends [any[]]
  ? ArrayFormField<TState>
  : [TState] extends [boolean | null | undefined]
  ? PrimitiveFormField<TState>
  : TState extends object
  ? ComplexFormField<TState>
  : PrimitiveFormField<TState>;

export interface ReadFormState<TState> {
  submit: () => void;
  reset: (newInitialValue?: TState) => void;
  submitting: boolean;
}

export type FormState<TState> = ConditionalFormField<TState> & ReadFormState<TState>;

interface ObjectFieldValidation<TState> {
  fieldValidation?: FieldValidation<TState>;
  validation?: FieldValidateFunc<TState>;
}

interface ArrayFieldValidation<TState extends any[]> {
  fieldValidation?: FieldValidation<TState[0]>;
  validation?: FieldValidateFunc<TState>;
}

type FieldValidationResult = string | undefined | null | Promise<string | undefined | null>;

type FieldValidateFunc<TValue> = (val: TValue) => FieldValidationResult;

type FieldValidation<TState> =
  | {
      [P in keyof TState]?: TState[P] extends any[]
        ? ArrayFieldValidation<TState[P]>
        : TState[P] extends object
        ? ObjectFieldValidation<TState[P]>
        : FieldValidateFunc<TState[P]>;
    }
  | undefined;

export type SubmitFunc<TState> = (state: TState) => Promise<any>;

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
    primitive: (x: PrimitiveFormField<T>) => x.value,
  });
}

function mapFormFields<TValue, F extends ConditionalFormField<TValue>>(
  field: F,
  updater: (prev: PrimitiveFormField<any>) => PrimitiveFormField<any>,
): TValue {
  return visitFormFields(field, {
    array: (x: ArrayFormField<TValue & any[]>) => ({
      ...x,
      value: x.value.map((item: any) => mapFormFields(item, updater)),
    }),
    complex: (x: ComplexFormField<TValue & {}>) => ({
      ...x,
      value: mapValues(x.value, innerField => mapFormFields(innerField as any, updater)),
    }),
    primitive: (y: PrimitiveFormField<TValue>) => updater(y),
  });
}

async function validateValue<TValue, TState extends ConditionalFormField<TValue>>(
  value: TState,
  validator?: ObjectFieldValidation<TValue> | ArrayFieldValidation<TValue & any[]> | FieldValidateFunc<TValue>,
) {
  if (!validator) {
    return;
  }
  if (typeof validator === "function") {
    return validator(extractFormFieldValues(value));
  } else if (validator.validation) {
    return validator.validation(extractFormFieldValues(value as any));
  }
}

async function mergeInValidationResults<TValue, TField extends ConditionalFormField<TValue>>(
  field: TField,
  validators?: ObjectFieldValidation<TValue> | ArrayFieldValidation<TValue & any[]> | FieldValidateFunc<TValue>,
): Promise<any> {
  return visitFormFields<TValue, TField>(field, {
    array: async x => ({
      ...x,
      value: await Promise.all(
        x.value.map(item =>
          mergeInValidationResults(
            item as any,
            typeof validators === "object" && validators.fieldValidation
              ? (validators.fieldValidation as any)
              : undefined,
          ),
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
            typeof validators === "object" && validators.fieldValidation
              ? (validators.fieldValidation as any)[key]
              : undefined,
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
  array: (field: ArrayFormField<TValue & any[]>) => any;
  complex: (field: ComplexFormField<TValue & object>) => any;
  primitive: (field: PrimitiveFormField<TValue>) => any;
}

function visitFormFields<TValue, TField extends ConditionalFormField<TValue>>(
  field: TField,
  visitor: Visitor<TValue>,
): any {
  if (field.type === "array") {
    return visitor.array(field as ArrayFormField<TValue & any[]>);
  } else if (field.type === "primitive") {
    return visitor.primitive(field as PrimitiveFormField<TValue>);
  } else {
    return visitor.complex(field as ComplexFormField<TValue & object>);
  }
}

function containsError<T>(field: ConditionalFormField<T>): boolean {
  if (field.type === "array" && field && field.value) {
    return ((field as unknown) as ArrayFormField<T & any[]>).value.some(containsError);
  } else if (field.type === "primitive") {
    return !!((field as unknown) as PrimitiveFormField<T>).error;
  } else {
    return Object.keys(field.value).some(key => containsError((field as any).value[key as any]));
  }
}

export type FormOptions<TState> = {
  submit: SubmitFunc<TState>;
} & ObjectFieldValidation<TState>;

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
      ...createFormField(initState, [], options, fieldsUpdater),
      submitting: false,
      dirty: false,
      reset: (newState?: TState) =>
        setState(prev => ({
          ...prev,
          ...createFormField(newState || initState, [], options, fieldsUpdater),
          dirty: false,
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
            ...mapFormFields(currentState as any, (value: PrimitiveFormField<any>) => ({
              ...value,
              props: { ...value.props, disabled: true },
              touched: true,
            })),
            submitting: true,
          });

          // Await and merge all validation results into the fields
          currentState = await mergeInValidationResults<TState, FormState<TState>>(currentState, options);

          // Submit if no error
          if (!containsError(currentState as any)) {
            await submitRef.current!(extractFormFieldValues(currentState));
            // "Un-touch" all
            setState(prev => ({
              ...prev,
              ...mapFormFields(prev as any, (value: PrimitiveFormField<any>) => ({
                ...value,
                touched: false,
              })),
            }));
          } else {
            setState(() => currentState);
          }
        } finally {
          setState(prev => ({
            ...prev,
            ...mapFormFields(prev as any, field => ({
              ...field,
              props: { ...field.props, disabled: false },
            })),
            submitting: false,
          }));
        }
      },
    };
  });

  React.useEffect(() => {
    stateRef.current = state;
    submitRef.current = options.submit;
    return () => {
      stateRef.current = undefined;
      submitRef.current = undefined;
    };
  });

  return state;
}

function getValdator<TValue>(
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
  validator: FieldValidateFunc<TValue> | undefined,
) {
  return (newValue: TValue) => {
    const valResult: any = validator ? validator(newValue) : undefined;

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
  fieldValidation: ObjectFieldValidation<TValue>,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): ConditionalFormField<TValue> {
  if (Array.isArray(initValue)) {
    return createArrayFormField(initValue, path, fieldValidation, setter as any) as ConditionalFormField<TValue>;
    // Consider null to be a primitive field
  } else if (typeof initValue === "object" && initValue !== null) {
    return (createComplexFormField(
      initValue as TValue & object,
      path,
      fieldValidation as ObjectFieldValidation<TValue & object>,
      setter as any,
    ) as unknown) as ConditionalFormField<TValue>;
  } else {
    return createPrimitiveFormField(initValue, path, fieldValidation, setter) as ConditionalFormField<TValue>;
  }
}

function createArrayFormField<TValue extends any[]>(
  initValue: TValue,
  path: Array<string | number>,
  fieldValidation: ArrayFieldValidation<TValue> | undefined,
  setter: (updater: (prev: ArrayFormField<TValue>) => ArrayFormField<TValue>) => void,
): ArrayFormField<TValue> {
  const createFormFieldInArray = <T>(val: T, index: number) =>
    createFormField(val, [...path, index], fieldValidation as any, updater =>
      setter(prev => ({
        ...prev,
        value: prev.value.map((prevValue: any, prevIndex) =>
          index === prevIndex ? updater(prevValue) : prevValue,
        ) as any,
      })),
    ) as ConditionalFormField<TValue[0]>;

  const executeValidation = getValdator(
    (setter as unknown) as (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
    fieldValidation ? fieldValidation.validation : undefined,
  );

  const setValue = (newValue: TValue) => {
    setter(prev => ({
      ...prev,
      value: newValue.map(createFormFieldInArray),
      ...executeValidation(newValue),
    }));
  };

  return {
    ...getBasicField(path, setValue),
    type: "array",
    value: initValue.map(createFormFieldInArray),
    remove: (index: number) => setter(prev => ({ ...prev, value: prev.value.filter((__, i) => i !== index) })),
    push: (newEntry: TValue[0]) =>
      setter(prev => ({
        ...prev,
        value: prev.value.concat([createFormFieldInArray(newEntry, prev.value.length)]),
      })) as any,
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
  objectValidation: ObjectFieldValidation<TValue> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): ComplexFormField<TValue> {
  const executeValidation = getValdator<TValue>(setter, objectValidation ? objectValidation.validation : undefined);

  const getFieldsFromValue = (newValue: TValue) =>
    createComplexFormFieldValues(
      newValue,
      path,
      objectValidation ? objectValidation.fieldValidation : undefined,
      updater =>
        setter(
          prev =>
            ({
              ...prev,
              value: updater(((prev || {}) as any).value),
            } as any),
        ) as any,
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
  validate: FieldValidateFunc<TValue> | ObjectFieldValidation<TValue> | undefined,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): PrimitiveFormField<TValue> {
  const executeValidation =
    validate && (validate as ObjectFieldValidation<TValue>).validation
      ? getValdator(setter, (validate as ObjectFieldValidation<TValue>).validation)
      : getValdator(setter, validate as FieldValidateFunc<TValue> | undefined);

  const setValue = (newValue: TValue) => {
    setter(prev => {
      // Tranform a primitive field to a complex fied (prop.field == null => prop.field == {})
      if (
        newValue !== null &&
        (!prev || prev.value === null || prev.value === undefined) &&
        typeof newValue === "object"
      ) {
        return createComplexFormField(
          newValue,
          path,
          validate as ObjectFieldValidation<TValue & {}>,
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
