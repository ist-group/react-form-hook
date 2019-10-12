import * as React from "react";
import * as _ from "lodash";

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

export interface ReadFormState<TState extends object> {
  value: FormObject<TState>;
  submitting: boolean;
  disabled: boolean;
  dirty: boolean;
}

export interface FormState<TState extends object> extends ReadFormState<TState> {
  submit: () => void;
  reset: (newInitialValue?: TState) => void;
}

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

function extractFormFieldValuesObject<TState extends {}>(values: FormObject<TState>) {
  return _.mapValues(values, extractFormFieldValues);
}

function extractFormFieldValues(field: any): any {
  return visitFormFields(field, {
    array: x => x.value.map(extractFormFieldValues),
    complex: x => _.mapValues(x.value, extractFormFieldValues),
    primitive: x => x.value,
  });
}

function mapFormFields<TValue>(
  field: TValue,
  updater: (prev: PrimitiveFormField<any>) => PrimitiveFormField<any>,
): TValue {
  return visitFormFields(field, {
    array: x => ({
      ...x,
      value: x.value.map((item: any) => mapFormFields(item, updater)),
    }),
    complex: x => ({
      ...x,
      value: _.mapValues(x.value, innerField => mapFormFields(innerField as any, updater)),
    }),
    primitive: y => updater(y),
  });
}

function validateFields<TValue>(field: ConditionalFormField<TValue>, validators: any): ConditionalFormField<TValue> {
  return visitFormFields(field, {
    array: x => x.value.map((item: any) => validateFields(item as any, validators && validators.fieldValidation)),
    complex: x =>
      _.mapValues(x.value, (innerField, key) =>
        validateFields(innerField as any, validators && validators.fieldValidation && validators.fieldValidation[key]),
      ),
    primitive: innerField =>
      validators && validators.fieldValidation ? validators.fieldValidation(innerField.value) : undefined,
  });
}
async function mergeInValidationResultsObject<TState extends object>(
  fields: FormObject<TState>,
  validationResults: any,
): Promise<any> {
  return Promise.all(
    Object.keys(fields).map(async key =>
      mergeInValidationResults((fields as any)[key], validationResults ? validationResults[key] : undefined),
    ),
  ).then((res: any) => _.fromPairs(Object.keys(fields).map((key, index) => [key, res[index]])));
}

async function mergeInValidationResults(field: ConditionalFormField<any>, validationResults: any): Promise<any> {
  return visitFormFields(field, {
    array: async x => ({
      ...x,
      value: await Promise.all(
        x.value.map((item: ConditionalFormField<any>, index: string | number) =>
          mergeInValidationResults(item, validationResults.value[index]),
        ),
      ),
      error: await validationResults,
    }),
    complex: async x => ({
      ...x,
      value: await mergeInValidationResultsObject(x.value, validationResults),
      error: await validationResults,
    }),
    primitive: async innerField => ({
      ...innerField,
      error: await validationResults,
    }),
  });
}

interface Visitor {
  array: (field: ArrayFormField<any>) => any;
  complex: (field: ComplexFormField<any>) => any;
  primitive: (field: PrimitiveFormField<any>) => any;
}

function visitFormFields<TValue>(field: any, visitor: Visitor): any {
  if (field.type === "array") {
    return visitor.array(field);
  } else if (field.type === "primitive") {
    return visitor.primitive(field);
  } else {
    return visitor.complex(field);
  }
}

function complexFieldContainsError<TValue extends object>(fields: FormObject<TValue>): boolean {
  return Object.keys(fields).some(key => containsError((fields as any)[key] as any));
}

function containsError(field: ConditionalFormField<any>): any {
  if (field.type === "array") {
    return field.value.some(containsError);
  } else if (field.type === "primitive") {
    return ((field as unknown) as PrimitiveFormField<any>).error;
  } else {
    return Object.keys(field.value).some(key => containsError(field.value[key as any]));
  }
}

export type FormOptions<TState> = {
  submit: SubmitFunc<TState>;
} & ObjectFieldValidation<TState>;

export function useForm<TState extends object>(initState: TState, options: FormOptions<TState>): FormState<TState> {
  const stateRef = React.useRef<FormState<TState>>();
  const submitRef = React.useRef<SubmitFunc<TState>>();

  let setState: (updater: (prev: FormState<TState>) => FormState<TState>) => void;
  let state: FormState<TState>;

  [state, setState] = React.useState<FormState<TState>>(() => {
    const fieldsUpdater = (updater: (fields: FormObject<TState>) => FormObject<TState>) => {
      setState(prev => {
        const value = updater(prev.value);
        const dirty = prev.dirty
          ? true
          : !_.isEqual(extractFormFieldValuesObject(prev.value), extractFormFieldValuesObject(value));
        return { ...prev, value, dirty };
      });
    };

    return {
      value: createComplexFormFieldValues(initState, [], options.fieldValidation, fieldsUpdater as any),
      disabled: false,
      submitting: false,
      dirty: false,
      reset: (newState?: TState) =>
        setState(prev => ({
          ...prev,
          value: createComplexFormFieldValues(newState || initState, [], options.fieldValidation, fieldsUpdater as any),
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
            value: _.mapValues(currentState.value, innderFields =>
              mapFormFields(innderFields, (value: PrimitiveFormField<any>) => ({
                ...value,
                disabled: true,
                touched: true,
              })),
            ) as any,
            disabled: true,
            submitting: true,
          });

          // Start field validation in parallell
          const valResults = _.mapValues(currentState.value, field =>
            validateFields(field as any, options.fieldValidation),
          );

          // TODO add form validation here

          // Await and merge all validation results into the fields
          currentState = updateState({
            ...currentState,
            value: await mergeInValidationResultsObject(currentState.value, valResults),
          });

          // Submit if no error
          if (!complexFieldContainsError(currentState.value)) {
            await submitRef.current!(extractFormFieldValuesObject(currentState.value));
            setState(prev => ({
              ...prev,
              dirty: false,
            }));
          }
        } finally {
          setState(prev => ({
            ...prev,
            fields: mapFormFields(prev.value, field => ({
              ...field,
              disabled: false,
            })),
            disabled: false,
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
        .then((res: any) =>
          setter(prev => (newValue === prev.value ? { ...prev, error: res, validating: false } : prev)),
        )
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
  fieldValidation: FieldValidation<TValue>,
  setter: (updater: (prev: ConditionalFormField<TValue>) => ConditionalFormField<TValue>) => void,
): ConditionalFormField<TValue> {
  if (_.isArray(initValue)) {
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
    return createPrimitiveFormField(initValue, path, fieldValidation as any, setter) as ConditionalFormField<TValue>;
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
    value: _.map(initValue, createFormFieldInArray),
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
  objectValidation: ObjectFieldValidation<TObject> | undefined,
  setter: (updater: (prev: ConditionalFormField<TObject>) => ConditionalFormField<TObject>) => void,
): FormObject<TObject> {
  return _.mapValues(object, (val, key) =>
    createFormField(
      val,
      [...path, key],
      ((objectValidation && objectValidation.fieldValidation ? objectValidation.fieldValidation : {}) as any)[key],
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
  objectValidation: ObjectFieldValidation<TValue>,
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

  const setValue = (newValue: TValue) => {
    if (newValue !== null) {
      setter(prev => ({
        ...prev,
        value: getFieldsFromValue(newValue),
        ...executeValidation(newValue),
      }));
    } else {
      setter(prev => ({
        ...prev,
        value: null,
        ...executeValidation(newValue),
      }));
    }
  };

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
      if ((!prev || prev.value === null || prev.value === undefined) && _.isObject(newValue)) {
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
          ...executeValidation(prev.value as any),
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
