import * as React from "react";
import * as _ from "lodash";

export interface PrimitiveFormField<TValue> {
  type: "primitive";
  props: {
    name: string;
    disabled: boolean;
    onChange: (ev: React.ChangeEvent<any>) => void;
    onBlur: () => void;
  };
  value: TValue;
  path: Array<string | number>;
  touched: boolean;
  error: string | undefined | null;
  validating: boolean;
  set: (val: TValue) => void;
}

export type ComplexFormField<TState> = {
  readonly [P in keyof TState]: Readonly<ConditionalFormField<TState[P]>>;
};

export interface ArrayFormField<TState> {
  type: "array";
  readonly array: Readonly<ConditionalFormField<TState>[]>;
  push: (newValue: TState) => void;
  remove: (index: number) => void;
}

export type FormField<TValue> = PrimitiveFormField<TValue> | ComplexFormField<TValue> | ArrayFormField<TValue>;

type ConditionalFormField<TState> = TState extends object[]
  ? ArrayFormField<TState[0]>
  : TState extends object
  ? ComplexFormField<TState>
  : TState extends boolean
  ? PrimitiveFormField<boolean> // Workaround for https://github.com/Microsoft/TypeScript/issues/30029
  : PrimitiveFormField<TState>;

export interface ReadFormState<TState> {
  fields: ComplexFormField<TState>;
  submitting: boolean;
  disabled: boolean;
}

export interface FormState<TState> extends ReadFormState<TState> {
  submit: () => void;
  reset: (newInitialValue?: TState) => void;
}

type FieldValidationResult = string | undefined | null | Promise<string | undefined | null>;

type FieldValidateFunc<TValue> = (val: TValue) => FieldValidationResult;
type ObjectIterator<TObject, TResult> = (value: TObject[keyof TObject], key: string, collection: TObject) => TResult;

type FieldValidation<TState> =
  | {
      [P in keyof TState]?: TState[P] extends any[]
        ? FieldValidation<TState[P][0]>
        : TState[P] extends object
        ? FieldValidation<TState[P]>
        : FieldValidateFunc<TState[P]>;
    }
  | undefined;

export type SubmitFunc<TState> = (state: TState) => Promise<any>;

function extractFormFieldValues(field: FormField<any>): any {
  return visitFormFields(field, {
    array: x => x.array.map(extractFormFieldValues),
    complex: x => _.mapValues(x, extractFormFieldValues),
    primitive: x => x.value,
  });
}

function mapFormFields(
  field: FormField<any>,
  updater: (prev: PrimitiveFormField<any>) => PrimitiveFormField<any>,
): any {
  return visitFormFields(field, {
    array: x => ({
      ...x,
      array: x.array.map(item => mapFormFields(item, updater)),
    }),
    complex: x => ({
      ..._.mapValues(x, innerField => mapFormFields(innerField, updater)),
    }),
    primitive: y => updater(y),
  });
}

function validateFields(field: FormField<any>, validators: any): any {
  return visitFormFields(field, {
    array: x => x.array.map(item => validateFields(item, validators)),
    complex: x => _.mapValues(x, (innerField, key) => validateFields(innerField, validators && validators[key])),
    primitive: innerField => (validators ? validators(innerField.value) : undefined),
  });
}

async function mergeInValidationResults(field: FormField<any>, validationResults: any): Promise<any> {
  return visitFormFields(field, {
    array: async x => ({
      ...x,
      array: await Promise.all(x.array.map((item, index) => mergeInValidationResults(item, validationResults[index]))),
    }),
    complex: async x =>
      Promise.all(
        Object.keys(x).map(async key =>
          mergeInValidationResults((x as any)[key], validationResults ? validationResults[key] : undefined),
        ),
      ).then((res: any) => _.fromPairs(Object.keys(x).map((key, index) => [key, res[index]]))),
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

function visitFormFields(field: FormField<any>, visitor: Visitor): any {
  if (field.type === "array") {
    return visitor.array(field);
  } else if (field.type === "primitive") {
    return visitor.primitive(field);
  } else {
    return visitor.complex(field);
  }
}

function containsError(field: FormField<any>): any {
  if (field.type === "array") {
    return field.array.some(containsError);
  } else if (field.type === "primitive") {
    return !!field.error;
  } else {
    return Object.keys(field).some(key => containsError(field[key]));
  }
}

export interface FormOptions<TState> {
  fieldValidation?: FieldValidation<TState>;
  submit: SubmitFunc<TState>;
}

export function useForm<TState extends object>(initState: TState, options: FormOptions<TState>): FormState<TState> {
  const stateRef = React.useRef<FormState<TState>>();
  const submitRef = React.useRef<SubmitFunc<TState>>();

  let setState: (updater: (prev: FormState<TState>) => FormState<TState>) => void;
  let state: FormState<TState>;

  [state, setState] = React.useState<FormState<TState>>(() => {
    const fieldsUpdater = (updater: (fields: ComplexFormField<TState>) => ComplexFormField<TState>) =>
      setState(prev => ({ ...prev, fields: updater(prev.fields) }));

    return {
      fields: createComplexFormField(initState, [], options.fieldValidation, fieldsUpdater),
      disabled: false,
      submitting: false,
      reset: (newState?: TState) =>
        setState(prev => ({
          ...prev,
          fields: createComplexFormField(newState || initState, [], options.fieldValidation, fieldsUpdater),
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
            fields: mapFormFields(currentState.fields, field => ({
              ...field,
              disabled: true,
              touched: true,
            })),
            disabled: true,
            submitting: true,
          });

          // Start field validation in parallell
          const valResults = validateFields(currentState.fields, options.fieldValidation);

          // TODO add form validation here

          // Await and merge all validation results into the fields
          currentState = updateState({
            ...currentState,
            fields: await mergeInValidationResults(currentState.fields, valResults),
          });

          // Submit if no error
          if (!containsError(currentState.fields)) {
            await submitRef.current!(extractFormFieldValues(currentState.fields));
          }
        } finally {
          setState(prev => ({
            ...prev,
            fields: mapFormFields(prev.fields, field => ({
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

function createFormField<TValue>(
  initValue: TValue,
  path: Array<string | number>,
  fieldValidation: FieldValidation<TValue>,
  setter: (updater: (prev: FormField<TValue>) => FormField<TValue>) => void,
): FormField<TValue> {
  if (_.isArray(initValue)) {
    return createArrayFormField(initValue, path, fieldValidation as any, setter as any) as any;
    // Consider null to be a primitive field
  } else if (typeof initValue === "object" && initValue !== null) {
    return createComplexFormField(initValue as any, path, fieldValidation, setter as any);
  } else {
    return createPrimitiveFormField(initValue, path, fieldValidation as any, setter as any);
  }
}

function createArrayFormField<TValue extends any[]>(
  initValue: TValue,
  path: Array<string | number>,
  fieldValidation: FieldValidation<TValue>,
  setter: (updater: (prev: ArrayFormField<TValue>) => ArrayFormField<TValue>) => void,
): ArrayFormField<TValue> {
  const createFormFieldInArray = (val: any, index: number) =>
    createFormField(
      val,
      [...path, index],
      fieldValidation as any,
      updater =>
        setter(prev => ({
          ...prev,
          array: prev.array.map((prevValue: any, prevIndex) =>
            index === prevIndex ? updater(prevValue) : prevValue,
          ) as any,
        })) as any,
    ) as any;

  return {
    type: "array",
    array: _.map(initValue, createFormFieldInArray),
    remove: (index: number) => setter(prev => ({ ...prev, array: prev.array.filter((__, i) => i !== index) })),
    push: (newEntry: TValue[0]) =>
      setter(prev => ({
        ...prev,
        array: prev.array.concat([createFormFieldInArray(newEntry, prev.array.length)]),
      })) as any,
  };
}

function createComplexFormField<TValue extends object>(
  initValue: TValue,
  path: Array<string | number>,
  fieldValidation: FieldValidation<TValue>,
  setter: (updater: (prev: ComplexFormField<TValue>) => ComplexFormField<TValue>) => void,
): ComplexFormField<TValue> {
  return _.mapValues(initValue, (val, key) =>
    createFormField(val as any, [...path, key], (fieldValidation || ({} as any))[key], (updater: (val: any) => void) =>
      setter(prev => ({
        ...prev,
        [key]: updater((prev as any)[key]),
      })),
    ),
  ) as any;
}

function createPrimitiveFormField<TValue>(
  initValue: TValue,
  path: Array<string | number>,
  validate: FieldValidateFunc<TValue> | undefined,
  setter: (updater: (prev: PrimitiveFormField<TValue>) => PrimitiveFormField<TValue>) => void,
): PrimitiveFormField<TValue> {
  const executeValidation = (newValue: TValue) => {
    const valResult: any = validate ? validate(newValue) : undefined;
    if (valResult && valResult.then && valResult.catch) {
      // Need to consider if the continuing validation is for the active value
      // TODO: cancellation and debouce support
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

  const setValue = (newValue: TValue) =>
    setter(prev => ({
      ...prev,
      value: newValue,
      ...executeValidation(newValue),
    }));

  return {
    type: "primitive",
    props: {
      name: pathToString(path),
      disabled: false,
      onChange: ev => setValue(ev.target.value),
      onBlur: () =>
        setter(prev => ({
          ...prev,
          touched: true,
          ...executeValidation(prev.value),
        })),
    },
    value: initValue,
    path,
    touched: false,
    error: undefined,
    validating: false,
    set: setValue,
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
