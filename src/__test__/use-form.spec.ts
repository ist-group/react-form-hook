// tslint:disable-next-line: no-implicit-dependencies
import { renderHook, act } from "@testing-library/react-hooks";
import { useForm } from "../index";

interface Item {
  id: string;
  name: string | null;
  description?: string;
  date: Date;
}

interface FormProps extends Item {
  list: Item[];
  item?: Item | null;
}

const getBasicFormSetup = (myMock?: jest.Mock<any, any>) =>
  renderHook(() =>
    useForm<FormProps>(
      {
        id: "",
        name: "",
        description: "",
        list: [
          { id: "", name: "", description: "" },
          { id: "2", name: "Test 2", description: "" },
        ],
        item: { id: "", name: "", description: "" },
      },
      {
        validation: {
          inner: {
            id: {
              onSubmit: value => !value && "Id is required",
            },
            list: {
              inner: {
                inner: {
                  id: {
                    onSubmit: value => !value && "Id is required",
                  },
                },
                onSubmit: value => !value.name && !value.description && "Either name or description is required",
              },
              onChange: list => list.length > 10 && "You can max have 10 list",
              onSubmit: list => list.length === 2 && "Two items is not allowed",
            },
            item: {
              inner: {
                id: {
                  onChange: value => !value && "Id is required",
                },
              },
              onSubmit: value => value && !value.name && !value.description && "Either name or description is required",
            },
          },
        },
        onSubmit: value => {
          if (myMock) {
            return myMock(value);
          }
        },
      },
    ),
  );

test("initial value", () => {
  const { result } = getBasicFormSetup();

  const date = new Date();

  act(() => {
    result.current.value.id.set("test");
    result.current.value.name.set("test2");
    result.current.value.description!.set("test3");
    result.current.value.date.set(date);
  });

  expect(result.current.value.id.value).toBe("test");
  expect(result.current.value.name.value).toBe("test2");
  expect(result.current.value.description!.value).toBe("test3");
  expect(result.current.value.date.value.toISOString()).toBe(date.toISOString());
});

test("Arrays - push", () => {
  const { result } = getBasicFormSetup();

  expect(result.current.value.list).toBeDefined();

  expect(result.current.value.list.touched).toBe(false);
  const date = new Date();
  act(() => {
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
  });
  expect(result.current.value.list.touched).toBe(true);
  expect(result.current.value.list.value[1].touched).toBe(false);

  expect(result.current.value.list.value.length).toBe(3);
  expect(result.current.value.list.value[2].value.id.value).toBe("id-test");
  expect(result.current.value.list.value[2].value.name.value).toBe("name-test");
  expect(result.current.value.list.value[2].value.description!.value).toBe("description-test");
});

test("Arrays -  onChange validation", () => {
  const { result } = getBasicFormSetup();

  const date = new Date();
  act(() => {
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test" });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test" });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test" });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test" });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test" });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test" });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test" });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test" });
  });
  expect(result.current.value.list.error).toBeFalsy();
  act(() => {
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
  });
  expect(result.current.value.list.error).toBe("You can max have 10 list");
});

test("onSubmit", async () => {
  const myMock = jest.fn(() => 0 / 0);
  const { result, waitForNextUpdate } = getBasicFormSetup(myMock);

  expect(result.current.value.list.error).toBeFalsy();
  expect(result.current.value.list.value[0].value.id.error).toBeFalsy();
  expect(result.current.value.list.value[0].error).toBeFalsy();
  expect(result.current.value.item!.value!.id.error).toBeFalsy();
  expect(result.current.value.item!.error).toBeFalsy();

  await act(async () => {
    const date = new Date();
    result.current.value.list.remove(0);
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.value.item!.value!.id.set("ok");
    result.current.value.item!.value!.name.set("ok");
    result.current.value.item!.value!.description!.set("ok");
    result.current.value.id.set("ok");
    result.current.value.name.set("ok");
    result.current.value.description!.set("ok");
  });

  await act(async () => {
    result.current.submit();
  });

  expect(myMock).toBeCalled();
  expect(result.current.value.id.value).toBe("ok");
  expect(result.current.value.id.error).toBeFalsy();
  expect(result.current.value.list.error).toBeFalsy();
  expect(result.current.value.item!.value!.id.error).toBeFalsy();
  expect(result.current.value.item!.error).toBeFalsy();
  expect(result.current.value.list.value[0].error).toBeFalsy();
  expect(result.current.value.list.value[0].value.id.error).toBeFalsy();
});

test("onSubmit executing", async () => {
  const myMock = jest.fn(() => new Promise(() => {}));
  const { result } = getBasicFormSetup(myMock);

  await act(async () => {
    const date = new Date();
    const newDate = new Date("2019-01-01");
    result.current.value.list.remove(0);
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.value.list.push({ id: "id-test", name: "name-test", description: "description-test", date });
    result.current.value.item!.value!.id.set("ok");
    result.current.value.item!.value!.name.set("ok");
    result.current.value.item!.value!.description!.set("ok");
    result.current.value.id.set("ok");
    result.current.value.name.set("ok");
    result.current.value.description!.set("ok");
    result.current.value.date.set(newDate);
  });

  await act(async () => {
    result.current.submit();
  });

  expect(result.current.submitting).toBeTruthy();
  expect(result.current.disabled).toBeTruthy();
  expect(result.current.touched).toBeTruthy();
  expect(result.current.value.id.disabled).toBeTruthy();
  expect(result.current.value.id.touched).toBeTruthy();
});

test("onSubmit validation", async () => {
  const myMock = jest.fn();
  const { result, waitForNextUpdate } = getBasicFormSetup(myMock);

  await act(async () => {
    result.current.submit();
  });

  expect(myMock.mock.calls.length).toBe(0);
  expect(result.current.value.id.value).toBe("");
  expect(result.current.value.id.error).toBe("Id is required");
  expect(result.current.value.list.error).toBe("Two items is not allowed");
  expect(result.current.value.item!.value!.id.error).toBe("Id is required");
  expect(result.current.value.item!.error).toBe("Either name or description is required");
  expect(result.current.value.list.value[0].error).toBe("Either name or description is required");
  expect(result.current.value.list.value[0].value.id.error).toBe("Id is required");
});

test("Arrays - remove - touched", () => {
  const { result } = getBasicFormSetup();
  expect(result.current.value.list.touched).toBe(false);

  act(() => {
    result.current.value.list.remove(1);
  });
  expect(result.current.value.list.touched).toBe(true);
  expect(result.current.value.list.value.length).toBe(1);
});

test("Arrays - remove set bindings", () => {
  const { result } = getBasicFormSetup();

  act(() => {
    const setMethod = result.current.value.list.value[1].value.name.set;
    setMethod("Before remove");
    result.current.value.list.remove(0);
    result.current.value.list.value[0].value.name.set("After remove");
  });
  expect(result.current.value.list.value[0].value.name.value).toBe("After remove");
  expect(result.current.value.list.value[0].path).toMatchObject(["list", 0]);
});

test("Date - date to array and back", () => {
  const { result } = getBasicFormSetup();

  const d1 = new Date("2019-01-01");
  const d2 = new Date("2019-01-02");

  act(() => {
    result.current.value.date.set(d1);
  });
  expect(result.current.value.date.value.toISOString()).toBe(d1.toISOString());

  act(() => {
    result.current.value.date.set([d1, d2]);
  });
  expect(result.current.value.date.value).toHaveLength(2);
  expect(((result.current.value.date.value as unknown) as Date[])[0].toISOString()).toBe(d1.toISOString());
  expect(((result.current.value.date.value as unknown) as Date[])[1].toISOString()).toBe(d2.toISOString());

  act(() => {
    result.current.value.date.set(d1);
  });
  expect(result.current.value.date.value.toISOString()).toBe(d1.toISOString());
});
